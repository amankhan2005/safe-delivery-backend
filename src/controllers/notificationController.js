/**
 * notificationController.js
 * UPDATE EXISTING FILE
 * Path: src/controllers/notificationController.js
 *
 * Changes vs original:
 *  - saveExpoPushToken() → new, saves Expo token for rider or customer
 *  - broadcastNotification() → new, admin broadcast via Expo Push
 *  - sendNotification(), getNotifications(), markNotificationRead() → UNCHANGED
 */

import { push }                       from '../services/notificationService.js';
import {
  broadcastPushNotification,
  isValidExpoPushToken,
}                                     from '../services/expoPushService.js';
import { ok, err }                    from '../utils/responseHelper.js';
import Notification                   from '../models/notificationModel.js';
import Rider                          from '../models/riderModel.js';
import User                           from '../models/userModel.js';

// ─── UNCHANGED: FCM single-token send (admin) ─────────────────────────────────

export async function sendNotification(req, res, next) {
  try {
    const { data } = req.body;
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : null;
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : null;
    const body  = typeof req.body.body  === 'string' ? req.body.body.trim()  : null;

    if (!token)  return err(res, 'token is required and must be a non-empty string.', 400);
    if (!title)  return err(res, 'title is required and must be a non-empty string.', 400);
    if (!body)   return err(res, 'body is required and must be a non-empty string.', 400);

    if (data !== undefined && (typeof data !== 'object' || Array.isArray(data) || data === null)) {
      return err(res, 'data must be a plain object (key-value pairs).', 400);
    }

    const result = await push(token, title, body, data || {});
    if (!result) return err(res, 'Failed to send notification. Check the FCM token.', 500);

    return ok(res, { messageId: result }, 'Notification sent successfully.');
  } catch (error) {
    next(error);
  }
}

// ─── UNCHANGED: Get notifications list ───────────────────────────────────────

export async function getNotifications(req, res, next) {
  try {
    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return ok(res, { notifications }, 'Notifications fetched.');
  } catch (error) {
    next(error);
  }
}

// ─── UNCHANGED: Mark notification read ───────────────────────────────────────

export async function markNotificationRead(req, res, next) {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { read: true } },
      { new: true }
    );
    if (!notif) return err(res, 'Notification not found.', 404);
    return ok(res, { notification: notif }, 'Notification marked as read.');
  } catch (error) {
    next(error);
  }
}

// ─── NEW: Save Expo push token ────────────────────────────────────────────────
// POST /api/notifications/expo-token
// Called by Rider App and Customer App after permission granted

export async function saveExpoPushToken(req, res, next) {
  try {
    const { expoPushToken } = req.body;

    if (!expoPushToken || typeof expoPushToken !== 'string') {
      return err(res, 'expoPushToken is required.', 400);
    }
    if (!isValidExpoPushToken(expoPushToken)) {
      return err(res, 'Invalid Expo push token format. Must start with ExponentPushToken[', 400);
    }

    const role = req.user?.role;

    if (role === 'rider') {
      await Rider.findByIdAndUpdate(req.user._id, { expoPushToken });
    } else {
      await User.findByIdAndUpdate(req.user._id, { expoPushToken });
    }

    return ok(res, {}, 'Expo push token saved.');
  } catch (error) {
    next(error);
  }
}

// ─── NEW: Admin broadcast via Expo Push ──────────────────────────────────────
// POST /api/notifications/broadcast
// Body: { audience: 'riders'|'customers'|'all', title, body, data? }

export async function broadcastNotification(req, res, next) {
  try {
    const { audience, title, body, data } = req.body;

    const validAudiences = ['riders', 'customers', 'all'];
    if (!validAudiences.includes(audience)) {
      return err(res, `audience must be one of: ${validAudiences.join(', ')}`, 400);
    }
    if (!title || typeof title !== 'string') return err(res, 'title is required.', 400);
    if (!body  || typeof body  !== 'string') return err(res, 'body is required.', 400);

    const result = await broadcastPushNotification(audience, title, body, data ?? {});
    return ok(res, result, `Broadcast sent to ${result.sent} device(s).`);
  } catch (error) {
    next(error);
  }
}