const { getMessaging } = require('../config/firebase');

/**
 * Send a push notification to a single FCM token.
 */
const push = async (token, title, body, data = {}) => {
  if (!token) return null;

  try {
    const messaging = getMessaging();
    const message = {
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    };

    const response = await messaging.send(message);
    return response;
  } catch (error) {
    console.error('FCM push error:', error.message);
    return null;
  }
};

const notifyRiderFound = async (token, riderName, eta) => {
  return push(token, '🛵 Rider Assigned!', `${riderName} is on the way. ETA: ${eta} mins.`, {
    type: 'RIDER_ASSIGNED',
    riderName,
    eta: String(eta),
  });
};

const notifyPickedUp = async (token) => {
  return push(token, '📦 Parcel Picked Up', 'Your parcel has been picked up and is on the way!', {
    type: 'PICKED_UP',
  });
};

const notifyArriving = async (token, mins) => {
  return push(token, '🚗 Rider Arriving', `Your rider is ${mins} minutes away. Please prepare to receive.`, {
    type: 'ARRIVING',
    mins: String(mins),
  });
};

const notifyDelivered = async (token) => {
  return push(token, '✅ Delivered!', 'Your parcel has been delivered successfully. Thank you for using Safe Delivery!', {
    type: 'DELIVERED',
  });
};

const notifyCancelled = async (token) => {
  return push(token, '❌ Order Cancelled', 'Your delivery order has been cancelled.', {
    type: 'CANCELLED',
  });
};

const notifyNewOrder = async (token, fare, miles) => {
  return push(token, '🆕 New Delivery Request', `New order: ${miles} miles — $${fare}. Tap to accept!`, {
    type: 'NEW_ORDER',
    fare: String(fare),
    miles: String(miles),
  });
};

const notifyAccountApproved = async (token) => {
  return push(token, '🎉 Account Approved!', 'Your Safe Delivery rider account is now approved. Go online and start earning!', {
    type: 'ACCOUNT_APPROVED',
  });
};

const notifyAccountRejected = async (token, reason) => {
  return push(token, '❌ Application Not Approved', `Your application was not approved. Reason: ${reason}`, {
    type: 'ACCOUNT_REJECTED',
    reason,
  });
};

const notifyAdminNewRider = async (token) => {
  return push(token, '👤 New Rider Application', 'A new rider has completed KYC and is awaiting approval.', {
    type: 'NEW_RIDER_KYC',
  });
};

const notifyRiderOrderCancelled = async (token, orderId) => {
  return push(token, '❌ Order Cancelled', 'The customer cancelled this delivery order.', {
    type: 'ORDER_CANCELLED',
    orderId,
  });
};

module.exports = {
  push,
  notifyRiderFound,
  notifyPickedUp,
  notifyArriving,
  notifyDelivered,
  notifyCancelled,
  notifyNewOrder,
  notifyAccountApproved,
  notifyAccountRejected,
  notifyAdminNewRider,
  notifyRiderOrderCancelled,
};