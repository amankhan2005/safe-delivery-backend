/**
 * expoPushService.js
 * NEW FILE — Backend Expo Push Notification Service
 *
 * Sends push notifications to Customer and Rider apps via Expo Push API.
 * Uses plain axios (already in your dependencies) — no new packages needed.
 *
 * Covers:
 *   - Rider: New order arrived (background/closed app)
 *   - Customer: Rider accepted, parcel picked up, delivered, cancelled
 *   - Admin: Broadcast to all riders / customers / both
 */

import axios from 'axios';
import Rider from '../models/riderModel.js';
import User  from '../models/userModel.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE    = 100; // Expo max per request

// ─── TOKEN VALIDATION ────────────────────────────────────────────────────────

export function isValidExpoPushToken(token) {
  if (!token || typeof token !== 'string') return false;
  return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
}

// ─── CORE SENDER ─────────────────────────────────────────────────────────────

export async function sendExpoPushNotifications(messages) {
  const msgs  = Array.isArray(messages) ? messages : [messages];
  const valid = msgs.filter((m) => isValidExpoPushToken(m.to));
  if (valid.length === 0) return [];

  const tickets = [];

  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHUNK_SIZE);
    try {
      const res  = await axios.post(EXPO_PUSH_URL, chunk, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 10_000,
      });
      const data = res.data?.data ?? [];
      tickets.push(...data);

      // Auto-remove invalid tokens
      for (let j = 0; j < data.length; j++) {
        if (data[j]?.status === 'error' && data[j]?.details?.error === 'DeviceNotRegistered') {
          removeExpoPushToken(chunk[j]?.to).catch(() => {});
        }
      }
    } catch (error) {
      console.error('[ExpoPush] Batch send error:', error?.message);
    }
  }

  return tickets;
}

// ─── SINGLE SEND HELPER ───────────────────────────────────────────────────────

export async function sendOnePush(token, title, body, data = {}, options = {}) {
  if (!isValidExpoPushToken(token)) return null;
  const tickets = await sendExpoPushNotifications([{
    to:        token,
    title,
    body,
    data,
    sound:     options.sound     ?? 'default',
    priority:  options.priority  ?? 'high',
    channelId: options.channelId ?? 'order_updates',
    ttl:       options.ttl       ?? 60,
  }]);
  return tickets[0] ?? null;
}

// ─── MULTI SEND HELPER ────────────────────────────────────────────────────────

export async function sendMultiPush(tokens, title, body, data = {}, options = {}) {
  const unique = [...new Set(tokens)].filter(isValidExpoPushToken);
  if (unique.length === 0) return [];
  return sendExpoPushNotifications(unique.map((to) => ({
    to,
    title,
    body,
    data,
    sound:     options.sound     ?? 'default',
    priority:  options.priority  ?? 'high',
    channelId: options.channelId ?? 'order_updates',
    ttl:       options.ttl       ?? 60,
  })));
}

// ─── RIDER NOTIFICATIONS ──────────────────────────────────────────────────────

/** New order available — sent when customer places order (rider app closed/background) */
export async function pushNewOrderToRider(expoPushToken, { orderId, fare, distanceMiles }) {
  return sendOnePush(
    expoPushToken,
    '🆕 New Delivery Request',
    `${distanceMiles} mi — ₹${fare}  |  Tap to view`,
    { type: 'NEW_ORDER', orderId: String(orderId), fare: String(fare), screen: 'IncomingOrder' },
    { channelId: 'new_order', priority: 'high' }
  );
}

/** Order cancelled by customer while rider was assigned */
export async function pushOrderCancelledToRider(expoPushToken, { orderId }) {
  return sendOnePush(
    expoPushToken,
    '❌ Order Cancelled',
    'Customer cancelled this order.',
    { type: 'ORDER_CANCELLED', orderId: String(orderId), screen: 'Home' },
    { channelId: 'order_updates', priority: 'normal' }
  );
}

// ─── CUSTOMER NOTIFICATIONS ───────────────────────────────────────────────────

/** Rider accepted the order */
export async function pushRiderAssigned(expoPushToken, { riderName, eta, orderId }) {
  return sendOnePush(
    expoPushToken,
    '🛵 Rider Assigned!',
    `${riderName} is on the way — ETA ${eta} min`,
    { type: 'RIDER_ASSIGNED', orderId: String(orderId), riderName, eta: String(eta), screen: 'Track' },
    { channelId: 'order_updates', priority: 'high' }
  );
}

/** Rider picked up the parcel */
export async function pushParcelPickedUp(expoPushToken, { orderId }) {
  return sendOnePush(
    expoPushToken,
    '📦 Parcel Picked Up',
    'Your parcel is on its way to you!',
    { type: 'PICKED_UP', orderId: String(orderId), screen: 'Track' },
    { channelId: 'order_updates', priority: 'high' }
  );
}

/** Rider started transit (on the way to drop) */
export async function pushOnTheWay(expoPushToken, { orderId, eta }) {
  return sendOnePush(
    expoPushToken,
    '🚗 Rider On The Way',
    eta ? `Arriving in ~${eta} minutes` : 'Rider is heading to your location',
    { type: 'ON_THE_WAY', orderId: String(orderId), screen: 'Track' },
    { channelId: 'order_updates', priority: 'high' }
  );
}

/** Order delivered successfully */
export async function pushDelivered(expoPushToken, { orderId }) {
  return sendOnePush(
    expoPushToken,
    '✅ Delivered!',
    'Your parcel has been delivered. Tap to rate your rider.',
    { type: 'DELIVERED', orderId: String(orderId), screen: 'Orders' },
    { channelId: 'order_updates', priority: 'high' }
  );
}

/** Order cancelled */
export async function pushOrderCancelled(expoPushToken, { orderId, reason }) {
  return sendOnePush(
    expoPushToken,
    '❌ Order Cancelled',
    reason ?? 'Your order was cancelled.',
    { type: 'ORDER_CANCELLED', orderId: String(orderId), screen: 'Home' },
    { channelId: 'order_updates', priority: 'normal' }
  );
}

// ─── ADMIN BROADCAST ─────────────────────────────────────────────────────────

export async function broadcastPushNotification(audience, title, body, data = {}) {
  const tokens = [];

  if (audience === 'riders' || audience === 'all') {
    const riders = await Rider.find(
      { expoPushToken: { $exists: true, $ne: null } },
      { expoPushToken: 1 }
    ).lean();
    riders.forEach((r) => { if (r.expoPushToken) tokens.push(r.expoPushToken); });
  }

  if (audience === 'customers' || audience === 'all') {
    const users = await User.find(
      { expoPushToken: { $exists: true, $ne: null } },
      { expoPushToken: 1 }
    ).lean();
    users.forEach((u) => { if (u.expoPushToken) tokens.push(u.expoPushToken); });
  }

  if (tokens.length === 0) {
    return { sent: 0, audience, message: 'No registered push tokens found.' };
  }

  const tickets = await sendMultiPush(tokens, title, body, {
    ...data,
    type:   data.type   ?? 'BROADCAST',
    screen: data.screen ?? 'Home',
  });

  return { sent: tokens.length, tickets, audience };
}

// ─── TOKEN CLEANUP ────────────────────────────────────────────────────────────

async function removeExpoPushToken(token) {
  if (!token) return;
  await Promise.allSettled([
    Rider.findOneAndUpdate({ expoPushToken: token }, { $unset: { expoPushToken: '' } }),
    User.findOneAndUpdate(  { expoPushToken: token }, { $unset: { expoPushToken: '' } }),
  ]);
  console.log('[ExpoPush] Removed stale token:', token);
}