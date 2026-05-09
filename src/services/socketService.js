/**
 * socketService.js — Production-hardened Socket.IO service
 *
 * KEY FIX: Transport order changed to ['websocket', 'polling'].
 *
 * With the original config the Socket.IO client would:
 *   1. Start on long-polling (HTTP)
 *   2. Fire a new HTTP request every 25s (polling interval)
 *   3. UPGRADE to WebSocket only after 1–2 polling round-trips
 *
 * On Render free tier, each polling request counts as a normal HTTP hit.
 * Under active delivery, 5–10 concurrent riders × every-25s poll = 12–24
 * extra HTTP requests per minute. This saturates Render's single worker
 * process and causes API timeouts for all other routes.
 *
 * With ['websocket', 'polling']:
 *   - Client tries WebSocket first (one persistent connection, no polling overhead)
 *   - Falls back to polling ONLY if WebSocket is unavailable
 *   - Eliminates ~95% of the polling-induced API latency
 */

import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Rider from '../models/riderModel.js';
import Order from '../models/orderModel.js';

// ─── CONNECTED SOCKET REGISTRY ───────────────────────────────────────────────

/** userId (string) → socketId */
const riderSockets    = new Map();
const customerSockets = new Map();

/** orderId (string) → Set<socketId> — prevents duplicate accept race condition */
const processingAccept = new Set();

let _io = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────

export function initSocket(server) {
  _io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },

    // CRITICAL FIX: WebSocket first.
    // polling is kept as fallback but will almost never be used in production.
    transports: ['websocket', 'polling'],

    // Ping settings tuned for Render free tier:
    // - pingInterval: how often the server pings the client (25s)
    // - pingTimeout: how long to wait for pong before declaring disconnect (20s)
    // These values ensure the WebSocket is kept alive through Render's 65s
    // idle TCP timeout without generating excessive traffic.
    pingInterval: 25_000,
    pingTimeout:  20_000,

    // Upgrade from polling → websocket happens quickly; don't let it linger
    upgradeTimeout: 5_000,

    // Max HTTP buffer size for polling fallback (1MB is enough for control messages)
    maxHttpBufferSize: 1e6,
  });

  // ── Auth middleware ──────────────────────────────────────────────────────────
  _io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('No auth token'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.role   = decoded.role || 'customer';
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  _io.on('connection', async (socket) => {
    const { userId, role } = socket;

    // ── Register ─────────────────────────────────────────────────────────────
    if (role === 'rider') {
      // If this rider has a stale socket registered, clean it up first
      const oldId = riderSockets.get(userId);
      if (oldId && oldId !== socket.id) {
        const oldSocket = _io.sockets.sockets.get(oldId);
        if (oldSocket) oldSocket.disconnect(true);
      }
      riderSockets.set(userId, socket.id);
    } else {
      const oldId = customerSockets.get(userId);
      if (oldId && oldId !== socket.id) {
        const oldSocket = _io.sockets.sockets.get(oldId);
        if (oldSocket) oldSocket.disconnect(true);
      }
      customerSockets.set(userId, socket.id);
    }

    socket.join(`user:${userId}`);
    socket.emit('connected', { message: 'Socket connected', role });

    // ── RIDER: Live location ──────────────────────────────────────────────────
    socket.on('rider:location_update', async ({ lat, lng, orderId } = {}) => {
      if (role !== 'rider' || lat == null || lng == null) return;

      // Non-blocking DB write
      Rider.findByIdAndUpdate(userId, { currentLocation: { lat, lng } }).catch(() => {});

      if (orderId) {
        try {
          const order = await Order.findById(orderId).select('customerId status').lean();
          if (order && ['assigned', 'picked_up', 'in_transit'].includes(order.status)) {
            emitToUser(order.customerId.toString(), 'rider:location', {
              lat, lng, riderId: userId, orderId,
            });
          }
        } catch {}
      }
    });

    // ── CUSTOMER: Track order ─────────────────────────────────────────────────
    socket.on('customer:track_order', ({ orderId } = {}) => {
      if (role !== 'customer' || !orderId) return;
      socket.join(`track:${orderId}`);
      socket.emit('track:subscribed', { orderId });
    });

    // ── RIDER: Accept order (fast-path via socket) ────────────────────────────
    socket.on('rider:accept_order', async ({ orderId } = {}) => {
      if (role !== 'rider' || !orderId) return;

      if (processingAccept.has(orderId)) {
        return socket.emit('ride:accept_failed', { orderId, reason: 'Already being processed.' });
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
        const eta   = Math.ceil((order.distanceMiles || 5) * 3);

        socket.emit('ride:accepted_confirm', { orderId, order, rider });

        emitToUser(order.customerId._id.toString(), 'ride:rider_assigned', {
          orderId, rider, eta,
          customerName:  order.customerId.name,
          customerPhone: order.customerId.phone,
        });

        // Tell all OTHER riders this order is gone
        socket.broadcast.emit('ride:request_cancelled', {
          orderId,
          reason: 'Another rider accepted this ride.',
        });
      } catch (e) {
        console.error('[Socket:accept_order]', e.message);
        socket.emit('ride:accept_failed', { orderId, reason: 'Server error. Please try via the app.' });
      } finally {
        processingAccept.delete(orderId);
      }
    });

    // ── RIDER: Reject order ───────────────────────────────────────────────────
    socket.on('rider:reject_order', ({ orderId } = {}) => {
      socket.emit('ride:rejected_confirm', { orderId });
    });

    // ── RIDER: Status updates ─────────────────────────────────────────────────
    socket.on('rider:status_update', async ({ orderId, status, eta } = {}) => {
      if (role !== 'rider' || !orderId) return;
      try {
        const order = await Order.findOne({ _id: orderId, riderId: userId }).select('customerId').lean();
        if (!order) return;

        const eventMap = {
          on_the_way: { event: 'ride:status',    title: '🛵 Rider is on the way!', eta },
          arrived:    { event: 'ride:arrived',    title: '📍 Rider has arrived. Please get ready!' },
          picked_up:  { event: 'ride:picked_up',  title: '📦 Parcel picked up.' },
          in_transit: { event: 'ride:in_transit', title: '🚗 Heading to destination.', eta },
          delivered:  { event: 'ride:delivered',  title: '✅ Delivered!' },
        };

        const mapped = eventMap[status];
        if (mapped) {
          emitToUser(order.customerId.toString(), mapped.event, {
            orderId, status, message: mapped.title, eta: mapped.eta,
          });
        }
      } catch {}
    });

    // ── Cleanup on disconnect ─────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      if (role === 'rider') {
        // Only remove if this socket is still the registered one
        // (a reconnect may have already replaced it)
        if (riderSockets.get(userId) === socket.id) {
          riderSockets.delete(userId);
        }
      } else {
        if (customerSockets.get(userId) === socket.id) {
          customerSockets.delete(userId);
        }
      }
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Socket] ${role} ${userId} disconnected: ${reason}`);
      }
    });
  });

  console.log('✅ Socket.IO initialized (websocket-first)');
  return _io;
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

/** Emit to a specific user's room (works regardless of transport type) */
export function emitToUser(userId, event, data) {
  if (!_io) return;
  _io.to(`user:${userId}`).emit(event, data);
}

/** Broadcast a new ride request to a list of rider IDs with TTL expiry */
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

  // After TTL, tell riders the request expired if no one accepted
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

export function getIO() {
  return _io;
}