// ============================================================
// FILE: src/services/notificationService.js  (BACKEND)
// COPY THIS ENTIRE FILE — replaces existing notificationService.js
// ============================================================

import { getMessaging } from '../config/firebase.js';

const messaging = getMessaging();

// ─────────────────────────────────────────────────────────────────────────────
// push()  ← For CUSTOMER notifications (foreground + background)
// Sends notification + data. Android shows it in system tray automatically.
// ─────────────────────────────────────────────────────────────────────────────

export const push = async (token, title, body, data = {}) => {
  if (!token) return null;

  try {
    const message = {
      token,
      notification: { title, body },

      // Include data so the app can navigate when tapped
      data: Object.fromEntries(
        Object.entries({ ...data, title, body }).map(([k, v]) => [k, String(v)])
      ),

      android: {
        priority: 'high',
        notification: {
          // CRITICAL: must match the channel created in the mobile app
          channelId:              'order_updates',
          priority:               'high',
          sound:                  'default',
          visibility:             'public',      // shows on lock screen
          defaultVibrateTimings:  false,
          vibrateTimingsMillis:   [0, 200, 100, 300],
          defaultSound:           true,
        },
      },

      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            sound:            'default',
            badge:            1,
            contentAvailable: 1,
          },
        },
      },
    };

    const result = await messaging.send(message);
    console.log('[FCM] push sent:', result);
    return result;
  } catch (error) {
    console.error('[FCM] push error:', error.message);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// pushDataOnly()  ← For RIDER new order (works when app is KILLED)
//
// WHY DATA-ONLY:
//   When you send a `notification` block, Android handles it silently
//   and your JS background task NEVER fires when the app is killed.
//   DATA-ONLY with priority=high wakes the JS TaskManager background task
//   so the rider app can create a local notification with fullScreenIntent.
//   This is exactly how Rapido / Uber / Ola driver apps work.
// ─────────────────────────────────────────────────────────────────────────────

export const pushDataOnly = async (token, data = {}) => {
  if (!token) return null;

  try {
    const message = {
      token,
      // NO notification block — pure data message
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority:     'high',   // MUST be high — wakes the background task
        ttl:          60000,    // 60 seconds TTL
        directBootOk: true,     // deliver even on locked screen
      },
      apns: {
        headers: {
          'apns-priority':  '10',
          'apns-push-type': 'background',
        },
        payload: { aps: { contentAvailable: 1 } },
      },
    };

    const result = await messaging.send(message);
    console.log('[FCM] pushDataOnly sent:', result);
    return result;
  } catch (error) {
    console.error('[FCM] pushDataOnly error:', error.message);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER notifications
// ─────────────────────────────────────────────────────────────────────────────

export const notifyRiderFound = (token, riderName, eta) =>
  push(token, '🛵 Rider Assigned!', `${riderName} is on the way. ETA: ${eta} mins.`, {
    type: 'RIDER_ASSIGNED', riderName, eta: String(eta),
  });

export const notifyPickedUp = (token) =>
  push(token, '📦 Parcel Picked Up', 'Your parcel has been picked up.', {
    type: 'PICKED_UP',
  });

export const notifyArriving = (token, mins) =>
  push(token, '🚗 Rider Arriving', `${mins} minutes away`, {
    type: 'ARRIVING', mins: String(mins),
  });

export const notifyDelivered = (token) =>
  push(token, '✅ Delivered!', 'Parcel delivered successfully.', {
    type: 'DELIVERED',
  });

export const notifyCancelled = (token) =>
  push(token, '❌ Order Cancelled', 'Order cancelled.', {
    type: 'CANCELLED',
  });

// ─────────────────────────────────────────────────────────────────────────────
// RIDER notifications
// ─────────────────────────────────────────────────────────────────────────────

// DATA-ONLY so killed-state background task fires and shows full-screen popup
export const notifyNewOrder = (token, fare, miles, extraData = {}) =>
  pushDataOnly(token, {
    type:          'NEW_ORDER',
    title:         '🆕 New Delivery Request',
    body:          `${miles} mi — ₹${fare}  |  Tap to Accept`,
    fare:          String(fare),
    miles:         String(miles),
    screen:        'IncomingOrder',
    ...extraData,
  });

export const notifyRiderOrderCancelled = (token, orderId) =>
  push(token, '❌ Order Cancelled', 'Customer cancelled order.', {
    type: 'ORDER_CANCELLED', orderId: String(orderId),
  });

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / ACCOUNT notifications
// ─────────────────────────────────────────────────────────────────────────────

export const notifyAccountApproved = (token) =>
  push(token, '🎉 Approved!', 'Your account is approved.', {
    type: 'ACCOUNT_APPROVED',
  });

export const notifyAccountRejected = (token, reason) =>
  push(token, '❌ Rejected', `Reason: ${reason}`, {
    type: 'ACCOUNT_REJECTED', reason,
  });

export const notifyAdminNewRider = (token) =>
  push(token, '👤 New Rider', 'New rider waiting for approval.', {
    type: 'NEW_RIDER_KYC',
  });