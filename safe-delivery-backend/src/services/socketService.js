/**
 * socketService.js
 *
 * Powers ALL real-time features via Socket.IO:
 *  - Rider live location streaming (smooth movement)
 *  - Ride request broadcast to nearby riders (with countdown)
 *  - First-come-first-serve atomic acceptance
 *  - Ride status notifications (customer + rider)
 *  - Rider arrival / ETA updates
 */

import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Rider from '../models/riderModel.js';
import User from '../models/userModel.js';
import Order from '../models/orderModel.js';

// ─── CONNECTED SOCKET REGISTRY ───────────────────────────────────────────────

/** riderId → socketId */
const riderSockets = new Map();

/** customerId → socketId */
const customerSockets = new Map();

/** Set of rideIds currently being processed (accepted) — prevents race conditions */
const processingAccept = new Set();

let _io = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────

export function initSocket(server) {
  _io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  // ── Auth middleware ──────────────────────────────────────────────────────────
  _io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('No auth token'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.role = decoded.role || 'customer';
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  _io.on('connection', async (socket) => {
    const { userId, role } = socket;

    // ── Register in registry ─────────────────────────────────────────────────
    if (role === 'rider') {
      riderSockets.set(userId, socket.id);
    } else {
      customerSockets.set(userId, socket.id);
    }

    socket.join(`user:${userId}`);
    socket.emit('connected', { message: 'Socket connected', role });

    // ── RIDER: Update live location ──────────────────────────────────────────
    // Payload: { lat, lng, orderId? }
    socket.on('rider:location_update', async ({ lat, lng, orderId } = {}) => {
      if (role !== 'rider') return;

      // Persist to DB (non-blocking)
      Rider.findByIdAndUpdate(userId, { currentLocation: { lat, lng } }).catch(() => {});

      if (orderId) {
        // Emit to customer tracking this order
        const order = await Order.findById(orderId).select('customerId status').lean();
        if (order && ['assigned', 'picked_up', 'in_transit'].includes(order.status)) {
          emitToUser(order.customerId.toString(), 'rider:location', {
            lat,
            lng,
            riderId: userId,
            orderId,
          });
        }
      }
    });

    // ── CUSTOMER: Subscribe to rider location for a specific order ───────────
    // Payload: { orderId }
    socket.on('customer:track_order', async ({ orderId } = {}) => {
      if (role !== 'customer') return;
      socket.join(`track:${orderId}`);
      socket.emit('track:subscribed', { orderId });
    });

    // ── RIDER: Accept ride request via socket (fast-path) ────────────────────
    // Payload: { orderId }
    socket.on('rider:accept_order', async ({ orderId } = {}) => {
      if (role !== 'rider') return;

      // Atomic lock — prevent race condition
      if (processingAccept.has(orderId)) {
        return socket.emit('ride:accept_failed', { orderId, reason: 'Order already being accepted.' });
      }

      processingAccept.add(orderId);

      try {
        const order = await Order.findOneAndUpdate(
          { _id: orderId, status: 'searching' },
          { $set: { riderId: userId, status: 'assigned', riderAssignedAt: new Date() } },
          { new: true }
        ).populate('customerId', 'name phone fcmToken');

        if (!order) {
          return socket.emit('ride:accept_failed', { orderId, reason: 'Order no longer available.' });
        }

        const rider = await Rider.findById(userId).select('name phone vehicle profilePhoto rating').lean();
        const eta = Math.ceil(order.distanceMiles * 3);

        // Notify the accepting rider
        socket.emit('ride:accepted_confirm', { orderId, order, rider });

        // Notify customer
        emitToUser(order.customerId._id.toString(), 'ride:rider_assigned', {
          orderId,
          rider,
          eta,
          customerName: order.customerId.name,
          customerPhone: order.customerId.phone,
        });

        // Broadcast cancellation to all other online riders
        socket.broadcast.emit('ride:request_cancelled', {
          orderId,
          reason: 'Another rider accepted this ride.',
        });
      } catch (err) {
        socket.emit('ride:accept_failed', { orderId, reason: 'Server error.' });
      } finally {
        processingAccept.delete(orderId);
      }
    });

    // ── RIDER: Reject ride request ───────────────────────────────────────────
    socket.on('rider:reject_order', ({ orderId } = {}) => {
      socket.emit('ride:rejected_confirm', { orderId });
    });

    // ── RIDER: Status update events ──────────────────────────────────────────
    // Payload: { orderId, status, eta? }
    socket.on('rider:status_update', async ({ orderId, status, eta } = {}) => {
      if (role !== 'rider') return;

      const order = await Order.findOne({ _id: orderId, riderId: userId }).select('customerId').lean();
      if (!order) return;

      const customerId = order.customerId.toString();

      const eventMap = {
        on_the_way: { event: 'ride:status', title: '🛵 Rider is on the way!', eta },
        arrived:    { event: 'ride:arrived', title: '📍 Rider has arrived. Please get ready!' },
        picked_up:  { event: 'ride:picked_up', title: '📦 Parcel picked up. In transit.' },
        in_transit: { event: 'ride:in_transit', title: '🚗 Ride started. Heading to destination.', eta },
        delivered:  { event: 'ride:delivered', title: '✅ Delivered successfully!' },
      };

      const mapped = eventMap[status];
      if (mapped) {
        emitToUser(customerId, mapped.event, {
          orderId,
          status,
          message: mapped.title,
          eta: mapped.eta,
        });
      }
    });

    // ── Disconnect cleanup ───────────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (role === 'rider') {
        riderSockets.delete(userId);
      } else {
        customerSockets.delete(userId);
      }
    });
  });

  console.log('✅ Socket.IO initialized');
  return _io;
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

/**
 * Emit an event to a specific user (customer or rider) by their DB id.
 */
export function emitToUser(userId, event, data) {
  if (!_io) return;
  _io.to(`user:${userId}`).emit(event, data);
}

/**
 * Broadcast a new ride request to all online approved riders.
 * Payload includes full order info + countdown TTL.
 */
export async function broadcastRideRequest(order, riderIds, ttlSeconds = 15) {
  if (!_io) return;

  const payload = {
    orderId: order._id.toString(),
    pickup: order.pickup,
    drop: order.drop,
    fare: order.fare,
    distanceMiles: order.distanceMiles,
    parcelWeight: order.parcelWeight,
    ttlSeconds,
    createdAt: new Date().toISOString(),
  };

  for (const riderId of riderIds) {
    emitToUser(riderId.toString(), 'ride:new_request', payload);
  }

  // Auto-expire after TTL — broadcast cancellation if still searching
  setTimeout(async () => {
    try {
      const stillSearching = await Order.findOne({ _id: order._id, status: 'searching' }).lean();
      if (stillSearching) {
        // Notify riders the request timed out
        for (const riderId of riderIds) {
          emitToUser(riderId.toString(), 'ride:request_expired', { orderId: order._id.toString() });
        }
      }
    } catch (_) {}
  }, ttlSeconds * 1000);
}

/**
 * Emit ride status event to customer.
 */
export function notifyCustomerStatus(customerId, event, data) {
  emitToUser(customerId.toString(), event, data);
}

/**
 * Emit ride status event to rider.
 */
export function notifyRiderStatus(riderId, event, data) {
  emitToUser(riderId.toString(), event, data);
}

export function getIO() {
  return _io;
}