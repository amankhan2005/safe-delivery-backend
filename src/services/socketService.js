import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Rider from '../models/riderModel.js';
import Order from '../models/orderModel.js';

const riderSockets     = new Map();
const customerSockets  = new Map();
const processingAccept = new Set();

const ACTIVE_STATUSES = ['assigned', 'picked_up', 'in_transit'];

let _io = null;

function safeStr(v, maxLen = 100) {
  if (v == null) return '';
  const s = String(v).trim();
  return s.length > maxLen ? '' : s;
}

function isValidId(id) {
  return /^[a-f\d]{24}$/i.test(safeStr(id));
}

export function initSocket(server) {
  _io = new Server(server, {
    cors:              { origin: '*', methods: ['GET', 'POST'] },
    transports:        ['websocket', 'polling'],
    pingInterval:      25_000,
    pingTimeout:       20_000,
    upgradeTimeout:    5_000,
    maxHttpBufferSize: 1e6,
  });

  _io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('No auth token'));
      const decoded  = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId  = decoded.id;
      socket.role    = decoded.role || 'customer';
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  _io.on('connection', async (socket) => {
    const { userId, role } = socket;

    if (role === 'rider') {
      const oldId = riderSockets.get(userId);
      if (oldId && oldId !== socket.id) {
        _io.sockets.sockets.get(oldId)?.disconnect(true);
      }
      riderSockets.set(userId, socket.id);
    } else {
      const oldId = customerSockets.get(userId);
      if (oldId && oldId !== socket.id) {
        _io.sockets.sockets.get(oldId)?.disconnect(true);
      }
      customerSockets.set(userId, socket.id);
    }

    socket.join(`user:${userId}`);
    socket.emit('connected', { message: 'Socket connected', role });

    socket.on('rider:location_update', async ({ lat, lng, orderId } = {}) => {
      if (role !== 'rider' || lat == null || lng == null) return;

      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);
      if (isNaN(parsedLat) || isNaN(parsedLng)) return;

      Rider.findByIdAndUpdate(userId, { currentLocation: { lat: parsedLat, lng: parsedLng } }).catch(() => {});

      if (orderId && isValidId(orderId)) {
        try {
          const order = await Order.findOne({
            _id: orderId, riderId: userId, status: { $in: ACTIVE_STATUSES },
          }).select('customerId status').lean();

          if (order) {
            emitToUser(order.customerId.toString(), 'rider:location', {
              lat: parsedLat, lng: parsedLng, riderId: userId, orderId,
            });
          }
        } catch {}
      }
    });

    socket.on('customer:track_order', ({ orderId } = {}) => {
      if (role !== 'customer' || !isValidId(orderId)) return;
      socket.join(`track:${orderId}`);
      socket.emit('track:subscribed', { orderId });
    });

    socket.on('rider:accept_order', async ({ orderId } = {}) => {
      if (role !== 'rider') return;

      const oid = safeStr(orderId);
      if (!isValidId(oid)) {
        return socket.emit('ride:accept_failed', { orderId: oid, reason: 'Invalid order ID.' });
      }

      if (processingAccept.has(oid)) {
        return socket.emit('ride:accept_failed', { orderId: oid, reason: 'Already being processed.' });
      }

      processingAccept.add(oid);

      try {
        const existingActive = await Order.findOne({
          riderId: userId,
          status:  { $in: ACTIVE_STATUSES },
        }).select('_id status').lean();

        if (existingActive) {
          return socket.emit('ride:accept_failed', {
            orderId: oid,
            reason: `You already have an active order (${existingActive.status}).`,
          });
        }

        const order = await Order.findOneAndUpdate(
          { _id: oid, status: 'searching' },
          { $set: { riderId: userId, status: 'assigned', riderAssignedAt: new Date() } },
          { new: true }
        ).populate('customerId', 'name phone fcmToken');

        if (!order) {
          return socket.emit('ride:accept_failed', { orderId: oid, reason: 'Order no longer available.' });
        }

        const rider = await Rider.findById(userId).select('name phone vehicle profilePhoto rating').lean();
        const eta   = Math.ceil((order.distanceMiles || 5) * 3);

        socket.emit('ride:accepted_confirm', { orderId: oid, order, rider });

        emitToUser(order.customerId._id.toString(), 'ride:rider_assigned', {
          orderId: oid, rider, eta,
          customerName:  order.customerId.name,
          customerPhone: order.customerId.phone,
        });

        socket.broadcast.emit('ride:request_cancelled', {
          orderId: oid,
          reason:  'Another rider accepted this ride.',
        });

        console.log(`[Socket:accept_order] Rider ${userId} accepted ${oid}`);
      } catch (e) {
        console.error('[Socket:accept_order]', e.message);
        socket.emit('ride:accept_failed', { orderId: oid, reason: 'Server error. Please try via the app.' });
      } finally {
        processingAccept.delete(oid);
      }
    });

    socket.on('rider:reject_order', ({ orderId } = {}) => {
      const oid = safeStr(orderId);
      socket.emit('ride:rejected_confirm', { orderId: oid });
    });

    socket.on('rider:status_update', async ({ orderId, status, eta } = {}) => {
      if (role !== 'rider' || !isValidId(orderId)) return;
      const oid = safeStr(orderId);

      try {
        const order = await Order.findOne({ _id: oid, riderId: userId }).select('customerId').lean();
        if (!order) return;

        const eventMap = {
          on_the_way: { event: 'ride:status',    title: '🛵 Rider is on the way!', eta },
          arrived:    { event: 'ride:arrived',    title: '📍 Rider has arrived. Please get ready!' },
          picked_up:  { event: 'ride:picked_up',  title: '📦 Parcel picked up.' },
          in_transit: { event: 'ride:in_transit', title: '🚗 Heading to destination.', eta },
          delivered:  { event: 'ride:delivered',  title: '✅ Delivered!' },
        };

        const mapped = eventMap[safeStr(status, 20)];
        if (mapped) {
          emitToUser(order.customerId.toString(), mapped.event, {
            orderId: oid, status, message: mapped.title, eta: mapped.eta,
          });
        }
      } catch {}
    });

    socket.on('disconnect', (reason) => {
      if (role === 'rider') {
        if (riderSockets.get(userId) === socket.id) riderSockets.delete(userId);
      } else {
        if (customerSockets.get(userId) === socket.id) customerSockets.delete(userId);
      }
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Socket] ${role} ${userId} disconnected: ${reason}`);
      }
    });
  });

  console.log('✅ Socket.IO initialized (websocket-first, hardened)');
  return _io;
}

export function emitToUser(userId, event, data) {
  if (!_io) return;
  _io.to(`user:${userId}`).emit(event, data);
}

export async function broadcastRideRequest(order, riderIds, ttlSeconds = 15) {
  if (!_io || !riderIds?.length) return;

  const payload = {
    orderId:       order._id.toString(),
    pickup:        order.pickup,
    drop:          order.drop,
    fare:          order.fare,
    distanceMiles: order.distanceMiles,
    parcelWeight:  order.parcelWeight,
    ttlSeconds,
    createdAt:     new Date().toISOString(),
  };

  for (const riderId of riderIds) {
    emitToUser(riderId.toString(), 'ride:new_request', payload);
  }

  setTimeout(async () => {
    try {
      const stillSearching = await Order.findOne({ _id: order._id, status: 'searching' }).lean();
      if (stillSearching) {
        for (const riderId of riderIds) {
          emitToUser(riderId.toString(), 'ride:request_expired', { orderId: order._id.toString() });
        }
      }
    } catch {}
  }, ttlSeconds * 1000);
}

export function notifyCustomerStatus(customerId, event, data) {
  emitToUser(customerId.toString(), event, data);
}

export function notifyRiderStatus(riderId, event, data) {
  emitToUser(riderId.toString(), event, data);
}

export function getIO() { return _io; }