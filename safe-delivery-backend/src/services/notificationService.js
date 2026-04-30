import { getMessaging } from '../config/firebase.js';

// initialize once
const messaging = getMessaging();

/**
 * Send push notification
 */
export const push = async (token, title, body, data = {}) => {
  if (!token) return null;

  try {
    const message = {
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    };

    return await messaging.send(message);
  } catch (error) {
    console.error('FCM push error:', error.message);
    return null;
  }
};

// ─── CUSTOMER ─────────────────────────

export const notifyRiderFound = (token, riderName, eta) =>
  push(
    token,
    '🛵 Rider Assigned!',
    `${riderName} is on the way. ETA: ${eta} mins.`,
    {
      type: 'RIDER_ASSIGNED',
      riderName,
      eta,
    }
  );

export const notifyPickedUp = (token) =>
  push(token, '📦 Parcel Picked Up', 'Your parcel has been picked up.', {
    type: 'PICKED_UP',
  });

export const notifyArriving = (token, mins) =>
  push(token, '🚗 Rider Arriving', `${mins} minutes away`, {
    type: 'ARRIVING',
    mins,
  });

export const notifyDelivered = (token) =>
  push(token, '✅ Delivered!', 'Parcel delivered successfully.', {
    type: 'DELIVERED',
  });

export const notifyCancelled = (token) =>
  push(token, '❌ Order Cancelled', 'Order cancelled.', {
    type: 'CANCELLED',
  });

// ─── RIDER ─────────────────────────

export const notifyNewOrder = (token, fare, miles) =>
  push(token, '🆕 New Order', `${miles} miles — ₹${fare}`, {
    type: 'NEW_ORDER',
    fare,
    miles,
  });

export const notifyRiderOrderCancelled = (token, orderId) =>
  push(token, '❌ Order Cancelled', 'Customer cancelled order.', {
    type: 'ORDER_CANCELLED',
    orderId,
  });

// ─── ACCOUNT / ADMIN ─────────────────────────

export const notifyAccountApproved = (token) =>
  push(token, '🎉 Approved!', 'Your account is approved.', {
    type: 'ACCOUNT_APPROVED',
  });

export const notifyAccountRejected = (token, reason) =>
  push(token, '❌ Rejected', `Reason: ${reason}`, {
    type: 'ACCOUNT_REJECTED',
    reason,
  });

export const notifyAdminNewRider = (token) =>
  push(token, '👤 New Rider', 'New rider waiting for approval.', {
    type: 'NEW_RIDER_KYC',
  });