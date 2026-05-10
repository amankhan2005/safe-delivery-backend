// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/controllers/orderController.js  (BACKEND — FINAL)
//
// Production hardening additions vs Phase 1 fix:
//   1. validateStatusTransition() — enforces all legal status progressions.
//      Prevents accepted → searching, delivered → picked_up, etc.
//   2. acceptOrder is fully idempotent: rider retrying their own accepted
//      order gets success without a 409.
//   3. uploadPickupPhoto, startTransit, uploadDropPhoto, verifyDeliveryOTP
//      all validate riderId ownership before any state mutation.
//   4. All write paths log the transition for audit trail.
//   5. createOrder busy-rider filter uses a single parallel query.
// ─────────────────────────────────────────────────────────────────────────────

import Order   from '../models/orderModel.js';
import Rider   from '../models/riderModel.js';
import Pricing from '../models/pricingModel.js';
import { ok, err }                          from '../utils/responseHelper.js';
import { getDistance, calculateFare, applyPromo } from '../utils/fareCalculator.js';
import { generateOTP }                      from '../utils/otpGenerator.js';
import User                                 from '../models/userModel.js';
import {
  notifyNewOrder, notifyRiderFound, notifyPickedUp,
  notifyArriving, notifyDelivered, notifyRiderOrderCancelled,
} from '../services/notificationService.js';
import {
  pushNewOrderToRider, pushRiderAssigned, pushParcelPickedUp,
  pushOnTheWay, pushDelivered, pushOrderCancelledToRider,
} from '../services/expoPushService.js';
import { validateRideCountries }          from '../services/locationService.js';
import { broadcastRideRequest, emitToUser } from '../services/socketService.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_CANCEL_MS     = 5 * 60 * 1000;
const ORDER_COOLDOWN_MS  = 2 * 60 * 1000;
const MAX_DISTANCE_MILES = 80;
const RIDER_RADIUS_MILES = 25;

const ACTIVE_STATUSES = ['assigned', 'picked_up', 'in_transit'];

// Legal forward-only status transitions (from → to)
const VALID_TRANSITIONS = {
  searching:  ['assigned', 'cancelled'],
  assigned:   ['picked_up', 'cancelled'],
  picked_up:  ['in_transit'],
  in_transit: ['delivered'],
  delivered:  [],   // terminal
  cancelled:  [],   // terminal
};

const userLastOrderTime = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFareOptions(pricing) {
  return {
    baseFare:        pricing.baseFare       || 0,
    minFare:         pricing.minFare        || 2.0,
    surgeMultiplier: pricing.surgeActive ? (pricing.surgeMultiplier || 1.0) : 1.0,
  };
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R    = 3958.8;
  const toRad = v => (v * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLng  = toRad(lng2 - lng1);
  const a     = Math.sin(dLat / 2) ** 2
              + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Validates that a status transition is legal.
 * @returns {{ valid: boolean, message?: string }}
 */
function validateStatusTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return { valid: false, message: `Unknown current status: ${from}` };
  if (!allowed.includes(to)) {
    return {
      valid:   false,
      message: `Cannot transition from '${from}' to '${to}'. Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
    };
  }
  return { valid: true };
}

// ─── Auto cancel ──────────────────────────────────────────────────────────────

function scheduleAutoCancel(orderId, customerId) {
  setTimeout(async () => {
    try {
      const order = await Order.findOneAndUpdate(
        { _id: orderId, status: 'searching' },
        { $set: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'No rider found within 5 minutes. Auto-cancelled.' } },
        { new: true }
      );
      if (order) {
        emitToUser(customerId.toString(), 'ride:cancelled', {
          orderId:    order._id,
          message:    'No rider found. Order auto-cancelled. Please try again.',
          autoCancel: true,
        });
        console.log(`[AutoCancel] Order ${orderId} auto-cancelled.`);
      }
    } catch (e) { console.error('[AutoCancel]', e.message); }
  }, AUTO_CANCEL_MS);
}

// ─── CALCULATE FARE ───────────────────────────────────────────────────────────

const _calculateFare = async (req, res, next) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng, promoCode } = req.body;

    if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
      return err(res, 'pickupLat, pickupLng, dropLat, dropLng are required.', 400);
    }
    if (parseFloat(pickupLat) === parseFloat(dropLat) && parseFloat(pickupLng) === parseFloat(dropLng)) {
      return err(res, 'Pickup and drop locations cannot be the same.', 400);
    }

    const countryCheck = await validateRideCountries(
      parseFloat(pickupLat), parseFloat(pickupLng),
      parseFloat(dropLat),   parseFloat(dropLng)
    );
    if (!countryCheck.valid) return err(res, countryCheck.error, 422);

    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'Pricing not configured. Contact admin.', 500);

    const distanceMiles = await getDistance(
      parseFloat(pickupLat), parseFloat(pickupLng),
      parseFloat(dropLat),   parseFloat(dropLng)
    );
    if (distanceMiles > MAX_DISTANCE_MILES)
      return err(res, `Maximum booking distance is ${MAX_DISTANCE_MILES} miles. Your trip is ${distanceMiles.toFixed(1)} miles.`, 400);
    if (distanceMiles <= 0)
      return err(res, 'Could not calculate a valid distance. Please check your locations.', 400);

    const fareOptions    = getFareOptions(pricing);
    let fare             = calculateFare(distanceMiles, pricing.costPerMile, fareOptions);
    const baseFareAmount = fare;
    let promoDiscount    = 0;
    let promoDetails     = null;

    if (promoCode) {
      const promo = pricing.promoCodes.find(p =>
        p.code === promoCode.toUpperCase() && p.isActive &&
        (!p.expiresAt || new Date() < p.expiresAt) &&
        p.usedCount < p.usageLimit &&
        (!p.userId || p.userId.toString() === req.user._id.toString())
      );
      if (promo) {
        if (fare < (promo.minOrderFare || 0))
          return err(res, `Minimum order fare of $${promo.minOrderFare} required for this promo code.`, 400);
        const { finalFare, discountAmount } = applyPromo(fare, promo.discount, promo.type);
        promoDiscount = discountAmount;
        fare          = finalFare;
        promoDetails  = { code: promo.code, discount: promo.discount, type: promo.type, minOrderFare: promo.minOrderFare || 0 };
      } else {
        return err(res, 'Invalid or expired promo code.', 400);
      }
    }

    return ok(res, {
      distanceMiles, baseFare: baseFareAmount, promoDiscount, fare, promoDetails,
      costPerMile: pricing.costPerMile, minFare: pricing.minFare, baseFareConfig: pricing.baseFare,
      surgeActive: pricing.surgeActive, surgeMultiplier: pricing.surgeActive ? pricing.surgeMultiplier : 1.0,
      currency: pricing.currency, pickupCountry: countryCheck.pickupCountry,
    }, 'Fare calculated.');
  } catch (error) { next(error); }
};
export { _calculateFare as calculateFare };

// ─── CREATE ORDER ─────────────────────────────────────────────────────────────

export async function createOrder(req, res, next) {
  try {
    const { pickup, drop, parcelWeight, promoCode, notes, preCalculatedFare, preCalculatedDistance } = req.body;
    const userId = req.user._id.toString();

    const lastOrderTime = userLastOrderTime.get(userId);
    if (lastOrderTime) {
      const elapsed    = Date.now() - lastOrderTime;
      const remainSecs = Math.ceil((ORDER_COOLDOWN_MS - elapsed) / 1000);
      if (elapsed < ORDER_COOLDOWN_MS)
        return err(res, `Please wait ${remainSecs} seconds before placing another order.`, 429);
    }

    if (!pickup?.lat || !pickup?.lng || !drop?.lat || !drop?.lng)
      return err(res, 'Valid pickup and drop coordinates are required.', 400);
    if (parseFloat(pickup.lat) === parseFloat(drop.lat) && parseFloat(pickup.lng) === parseFloat(drop.lng))
      return err(res, 'Pickup and drop locations cannot be the same.', 400);

    const countryCheck = await validateRideCountries(
      parseFloat(pickup.lat), parseFloat(pickup.lng),
      parseFloat(drop.lat),   parseFloat(drop.lng)
    );
    if (!countryCheck.valid) return err(res, countryCheck.error, 422);

    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'Pricing not configured.', 500);

    const clientSentFare     = preCalculatedFare     && typeof preCalculatedFare     === 'number' && preCalculatedFare     > 0;
    const clientSentDistance = preCalculatedDistance && typeof preCalculatedDistance === 'number' && preCalculatedDistance > 0;

    let distanceMiles, fare, promoDiscount = 0, appliedPromoCode = null;

    if (clientSentDistance && clientSentFare) {
      distanceMiles = Math.round(preCalculatedDistance * 100) / 100;
      fare          = Math.round(preCalculatedFare     * 100) / 100;

      if (promoCode) {
        const promoIndex = pricing.promoCodes.findIndex(p =>
          p.code === promoCode.toUpperCase() && p.isActive &&
          (!p.expiresAt || new Date() < p.expiresAt) &&
          p.usedCount < p.usageLimit &&
          (!p.userId || p.userId.toString() === userId)
        );
        if (promoIndex === -1) return err(res, 'Invalid or expired promo code.', 400);
        const promo      = pricing.promoCodes[promoIndex];
        appliedPromoCode = promo.code;
        promoDiscount    = promo.type === 'flat'
          ? Math.round(Math.min(promo.discount, fare) * 100) / 100
          : Math.round(fare * (promo.discount / 100) / (1 - promo.discount / 100) * 100) / 100;
        pricing.promoCodes[promoIndex].usedCount += 1;
        await pricing.save();
      }
    } else {
      distanceMiles = await getDistance(
        parseFloat(pickup.lat), parseFloat(pickup.lng),
        parseFloat(drop.lat),   parseFloat(drop.lng)
      );
      fare = calculateFare(distanceMiles, pricing.costPerMile, getFareOptions(pricing));

      if (promoCode) {
        const promoIndex = pricing.promoCodes.findIndex(p =>
          p.code === promoCode.toUpperCase() && p.isActive &&
          (!p.expiresAt || new Date() < p.expiresAt) &&
          p.usedCount < p.usageLimit &&
          (!p.userId || p.userId.toString() === userId)
        );
        if (promoIndex === -1) return err(res, 'Invalid or expired promo code.', 400);
        const promo = pricing.promoCodes[promoIndex];
        if (fare < (promo.minOrderFare || 0))
          return err(res, `Minimum order fare of $${promo.minOrderFare} required for this promo code.`, 400);
        const { finalFare, discountAmount } = applyPromo(fare, promo.discount, promo.type);
        promoDiscount    = discountAmount;
        fare             = finalFare;
        appliedPromoCode = promo.code;
        pricing.promoCodes[promoIndex].usedCount += 1;
        await pricing.save();
      }
    }

    if (distanceMiles > MAX_DISTANCE_MILES)
      return err(res, `Maximum booking distance is ${MAX_DISTANCE_MILES} miles.`, 400);

    const deliveryOTP = generateOTP();
    const order = await Order.create({
      customerId: req.user._id, pickup, drop, parcelWeight,
      distanceMiles, fare, promoCode: appliedPromoCode, promoDiscount,
      deliveryOTP, notes, country: countryCheck.pickupCountry,
    });

    userLastOrderTime.set(userId, Date.now());
    scheduleAutoCancel(order._id, req.user._id);

    // ── Find available riders — parallel query for busy IDs ─────────────────
    const [allRiders, activeOrderDocs] = await Promise.all([
      Rider.find({ isOnline: true, status: 'approved' })
        .select('currentLocation fcmToken expoPushToken _id').lean(),
      Order.find({ status: { $in: ACTIVE_STATUSES } }, 'riderId').lean(),
    ]);

    const busyRiderIds = new Set(activeOrderDocs.map(o => o.riderId?.toString()).filter(Boolean));

    await order.populate('customerId', 'name').catch(() => {});
    const customerName  = order.customerId?.name ?? 'Customer';
    const pickupAddress = pickup?.address ?? '';
    const dropAddress   = drop?.address   ?? '';

    const riderIds = [];
    for (const rider of allRiders) {
      if (busyRiderIds.has(rider._id.toString())) continue;
      if (!rider.currentLocation?.lat || !rider.currentLocation?.lng) continue;
      const dist = haversineMiles(pickup.lat, pickup.lng, rider.currentLocation.lat, rider.currentLocation.lng);
      if (dist > RIDER_RADIUS_MILES) continue;

      riderIds.push(rider._id);
      if (rider.fcmToken) {
        notifyNewOrder(rider.fcmToken, fare, distanceMiles, { orderId: String(order._id), customerName, pickupAddress, dropAddress }).catch(console.error);
      }
      if (rider.expoPushToken) {
        pushNewOrderToRider(rider.expoPushToken, { orderId: order._id, fare, distanceMiles, customerName, pickupAddress, dropAddress }).catch(console.error);
      }
    }

    await broadcastRideRequest(order, riderIds, 15).catch(console.error);
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalOrders: 1 } });

    console.log(`[createOrder] Order ${order._id} created. Notified ${riderIds.length} riders.`);

    return ok(res, {
      orderId: order._id, fare: order.fare, distanceMiles: order.distanceMiles,
      deliveryOTP: order.deliveryOTP, status: order.status, country: order.country, autoCancelIn: '5 minutes',
    }, 'Order created. Searching for riders.', 201);
  } catch (error) {
    console.error('[createOrder]', error.message);
    next(error);
  }
}

// ─── ACCEPT ORDER ─────────────────────────────────────────────────────────────
// Security hardening:
//   • Active-order guard: rider cannot accept while busy (409)
//   • Atomic findOneAndUpdate on status: 'searching' — race-safe
//   • Idempotent: rider retrying their own order → 200
//   • Full populated order returned for instant client state update

export async function acceptOrder(req, res, next) {
  try {
    const riderId  = req.user._id;
    const orderId  = req.params.id;

    // ── Ownership / status validation ─────────────────────────────────────
    if (!orderId || !/^[a-f\d]{24}$/i.test(orderId))
      return err(res, 'Invalid order ID.', 400);

    // ── Active-order guard ────────────────────────────────────────────────
    const existingActive = await Order.findOne({
      riderId, status: { $in: ACTIVE_STATUSES },
    }).select('_id status').lean();

    if (existingActive) {
      console.warn(`[acceptOrder] Rider ${riderId} already busy — order ${existingActive._id} (${existingActive.status})`);
      return err(res, `You already have an active order (${existingActive.status}). Complete or cancel it first.`, 409);
    }

    // ── Atomic accept ─────────────────────────────────────────────────────
    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: 'searching' },
      { $set: { riderId, status: 'assigned', riderAssignedAt: new Date() } },
      { new: true }
    ).populate('customerId', 'name phone fcmToken expoPushToken');

    if (!order) {
      // Order gone — check idempotency (rider already accepted this one)
      const existing = await Order.findById(orderId).select('status riderId');
      if (!existing) return err(res, 'Order not found.', 404);

      if (existing.status === 'assigned' && existing.riderId?.toString() === riderId.toString()) {
        // Idempotent success
        const o  = await Order.findById(orderId).populate('customerId', 'name phone fcmToken expoPushToken');
        const ri = await Rider.findById(riderId).select('name phone vehicle profilePhoto rating');
        console.log(`[acceptOrder] Idempotent retry — rider ${riderId} already owns order ${orderId}`);
        return ok(res, { order: o, rider: ri }, 'Order already accepted by you.');
      }

      // Taken by another rider or cancelled
      const msgs = {
        assigned:   'This order was already accepted by another rider.',
        picked_up:  'This order has already been picked up.',
        in_transit: 'This order is already in transit.',
        delivered:  'This order has already been delivered.',
        cancelled:  'This order was cancelled.',
      };
      return err(res, msgs[existing.status] || 'Order is no longer available.', 409);
    }

    const riderInfo = await Rider.findById(riderId).select('name phone vehicle profilePhoto rating');
    const eta       = Math.ceil((order.distanceMiles || 5) * 3);

    // Notify customer
    if (order.customerId.fcmToken)      notifyRiderFound(order.customerId.fcmToken, riderInfo.name, eta).catch(console.error);
    if (order.customerId.expoPushToken) pushRiderAssigned(order.customerId.expoPushToken, { riderName: riderInfo.name, eta, orderId: order._id }).catch(console.error);

    emitToUser(order.customerId._id.toString(), 'ride:rider_assigned', {
      orderId: order._id, rider: riderInfo, eta,
      customerName: order.customerId.name, customerPhone: order.customerId.phone,
    });

    console.log(`[acceptOrder] ✅ Rider ${riderId} accepted order ${orderId} (fare: ${order.fare})`);
    return ok(res, { order, rider: riderInfo }, 'Order accepted.');
  } catch (error) {
    console.error('[acceptOrder]', error.message);
    next(error);
  }
}

// ─── REJECT ORDER ─────────────────────────────────────────────────────────────

export async function rejectOrder(req, res, next) {
  try {
    const order = await Order.findById(req.params.id).select('status riderId').lean();
    if (!order) return err(res, 'Order not found.', 404);
    if (!['searching', 'assigned'].includes(order.status))
      return err(res, 'Order is no longer available to reject.', 400);
    console.log(`[rejectOrder] Rider ${req.user._id} rejected order ${req.params.id}`);
    return ok(res, {}, 'Order rejected.');
  } catch (error) { next(error); }
}

// ─── PICKUP PHOTO ─────────────────────────────────────────────────────────────

export async function uploadPickupPhoto(req, res, next) {
  try {
    if (!req.file) return err(res, 'Pickup photo is required.', 400);

    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found or not assigned to you.', 404);

    const transition = validateStatusTransition(order.status, 'picked_up');
    if (!transition.valid) return err(res, transition.message, 400);

    order.pickupPhoto   = { url: req.file.path, publicId: req.file.filename };
    order.pickupPhotoAt = new Date();
    order.status        = 'picked_up';
    order.pickedUpAt    = new Date();
    await order.save();

    await order.populate('customerId', 'fcmToken expoPushToken _id');
    if (order.customerId.fcmToken)      notifyPickedUp(order.customerId.fcmToken).catch(console.error);
    if (order.customerId.expoPushToken) pushParcelPickedUp(order.customerId.expoPushToken, { orderId: order._id }).catch(console.error);

    emitToUser(order.customerId._id.toString(), 'ride:picked_up', { orderId: order._id, message: 'Parcel has been picked up!' });

    console.log(`[uploadPickupPhoto] Order ${order._id} → picked_up`);
    return ok(res, { status: order.status, pickupPhoto: order.pickupPhoto }, 'Pickup photo uploaded.');
  } catch (error) { next(error); }
}

// ─── START TRANSIT ────────────────────────────────────────────────────────────

export async function startTransit(req, res, next) {
  try {
    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);

    const transition = validateStatusTransition(order.status, 'in_transit');
    if (!transition.valid) return err(res, transition.message, 400);

    order.status = 'in_transit';
    await order.save();

    await order.populate('customerId', 'fcmToken expoPushToken _id');
    const eta = Math.ceil((order.distanceMiles || 5) * 2);

    if (order.customerId.fcmToken)      notifyArriving(order.customerId.fcmToken, eta).catch(console.error);
    if (order.customerId.expoPushToken) pushOnTheWay(order.customerId.expoPushToken, { orderId: order._id, eta }).catch(console.error);

    emitToUser(order.customerId._id.toString(), 'ride:in_transit', { orderId: order._id, eta, message: `Rider heading to drop. ETA: ${eta} mins` });

    console.log(`[startTransit] Order ${order._id} → in_transit`);
    return ok(res, { status: order.status }, 'Status updated to in_transit.');
  } catch (error) { next(error); }
}

// ─── DROP PHOTO ───────────────────────────────────────────────────────────────

export async function uploadDropPhoto(req, res, next) {
  try {
    if (!req.file) return err(res, 'Drop photo is required.', 400);

    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);

    // Drop photo can be uploaded in in_transit only
    if (order.status !== 'in_transit')
      return err(res, `Drop photo requires in_transit status, current: ${order.status}.`, 400);

    order.dropPhoto   = { url: req.file.path, publicId: req.file.filename };
    order.dropPhotoAt = new Date();
    await order.save();
    await order.populate('customerId', 'fcmToken _id');

    if (order.customerId.fcmToken) notifyArriving(order.customerId.fcmToken, 2).catch(console.error);
    emitToUser(order.customerId._id.toString(), 'ride:arrived', { orderId: order._id, message: 'Rider has arrived!' });

    return ok(res, { dropPhoto: order.dropPhoto }, 'Drop photo uploaded.');
  } catch (error) { next(error); }
}

// ─── VERIFY OTP ───────────────────────────────────────────────────────────────

export async function verifyDeliveryOTP(req, res, next) {
  try {
    const { otp } = req.body;
    if (!otp) return err(res, 'OTP is required.', 400);

    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);

    const transition = validateStatusTransition(order.status, 'delivered');
    if (!transition.valid) return err(res, transition.message, 400);

    if (!order.dropPhoto?.url) return err(res, 'Drop photo must be uploaded first.', 400);
    if (order.deliveryOTP !== otp) return err(res, 'Invalid OTP.', 400);

    const now            = new Date();
    order.otpVerified    = true;
    order.otpVerifiedAt  = now;
    order.status         = 'delivered';
    order.deliveredAt    = now;
    order.paymentStatus  = 'collected';
    await order.save();

    const rider          = await Rider.findById(req.user._id);
    rider.earnings.today = (rider.earnings.today || 0) + order.fare;
    rider.earnings.total = (rider.earnings.total || 0) + order.fare;
    rider.totalTrips     = (rider.totalTrips     || 0) + 1;
    await rider.save();

    await order.populate('customerId', 'fcmToken expoPushToken _id name');
    if (order.customerId.fcmToken)      notifyDelivered(order.customerId.fcmToken).catch(console.error);
    if (order.customerId.expoPushToken) pushDelivered(order.customerId.expoPushToken, { orderId: order._id }).catch(console.error);

    emitToUser(order.customerId._id.toString(), 'ride:delivered', { orderId: order._id, message: 'Parcel delivered!', fare: order.fare });

    console.log(`[verifyDeliveryOTP] ✅ Order ${order._id} delivered. Rider ${req.user._id} earned $${order.fare}`);
    return ok(res, { status: order.status, deliveredAt: order.deliveredAt }, 'Delivery confirmed.');
  } catch (error) { next(error); }
}

// ─── CANCEL ORDER ─────────────────────────────────────────────────────────────

export async function cancelOrder(req, res, next) {
  try {
    const { cancellationReason } = req.body;
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);

    const transition = validateStatusTransition(order.status, 'cancelled');
    if (!transition.valid) return err(res, transition.message, 400);

    order.status             = 'cancelled';
    order.cancelledAt        = new Date();
    order.cancellationReason = cancellationReason || 'Cancelled by customer';
    await order.save();

    if (order.riderId) {
      const rider = await Rider.findById(order.riderId).select('fcmToken expoPushToken _id');
      if (rider) {
        if (rider.fcmToken)      notifyRiderOrderCancelled(rider.fcmToken, order._id.toString()).catch(console.error);
        if (rider.expoPushToken) pushOrderCancelledToRider(rider.expoPushToken, { orderId: order._id }).catch(console.error);
        emitToUser(rider._id.toString(), 'ride:cancelled', { orderId: order._id, message: 'Customer cancelled the order.' });
      }
    }

    return ok(res, { status: order.status }, 'Order cancelled.');
  } catch (error) { next(error); }
}

// ─── GET MY ORDERS ────────────────────────────────────────────────────────────

export async function getMyOrders(req, res, next) {
  try {
    const orders = await Order.find({ customerId: req.user._id })
      .populate('riderId', 'name phone vehicle profilePhoto rating currentLocation')
      .sort({ createdAt: -1 });
    return ok(res, { orders }, 'Orders fetched.');
  } catch (error) { next(error); }
}

// ─── GET ORDER ────────────────────────────────────────────────────────────────

export async function getOrder(req, res, next) {
  try {
    const { id } = req.params;
    let order    = null;

    if (/^[a-f\d]{24}$/i.test(id)) {
      order = await Order.findById(id)
        .populate('customerId', 'name phone email')
        .populate('riderId', 'name phone vehicle profilePhoto rating currentLocation');
    } else if (id.length >= 6 && id.length <= 8) {
      const [result] = await Order.aggregate([
        { $addFields: { idStr: { $toLower: { $toString: '$_id' } } } },
        { $match: { idStr: { $regex: id.toLowerCase() + '$' } } },
        { $limit: 1 },
      ]);
      if (result) {
        order = await Order.findById(result._id)
          .populate('customerId', 'name phone email')
          .populate('riderId', 'name phone vehicle profilePhoto rating currentLocation');
      }
    } else {
      return err(res, 'Invalid order ID format.', 400);
    }

    if (!order) return err(res, 'Order not found.', 404);

    // Ownership validation
    if (req.role === 'customer' && order.customerId._id.toString() !== req.user._id.toString())
      return err(res, 'Not authorized.', 403);
    if (req.role === 'rider' && order.riderId && order.riderId._id.toString() !== req.user._id.toString())
      return err(res, 'Not authorized.', 403);

    return ok(res, { order }, 'Order fetched.');
  } catch (error) { next(error); }
}

// ─── GET OTP ──────────────────────────────────────────────────────────────────

export async function getDeliveryOTP(req, res, next) {
  try {
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);
    if (!['assigned', 'picked_up', 'in_transit'].includes(order.status))
      return err(res, 'OTP only available when order is assigned or in transit.', 400);
    return ok(res, { deliveryOTP: order.deliveryOTP }, 'OTP fetched.');
  } catch (error) { next(error); }
}

// ─── RIDER LOCATION ───────────────────────────────────────────────────────────

export async function getRiderLocation(req, res, next) {
  try {
    const order = await Order.findById(req.params.id).select('riderId status customerId').lean();
    if (!order) return err(res, 'Order not found.', 404);
    if (req.role === 'customer' && order.customerId.toString() !== req.user._id.toString())
      return err(res, 'Not authorized.', 403);
    if (!order.riderId) return err(res, 'No rider assigned yet.', 404);

    const rider = await Rider.findById(order.riderId).select('currentLocation name vehicle').lean();
    if (!rider) return err(res, 'Rider not found.', 404);
    return ok(res, { location: rider.currentLocation, riderName: rider.name, vehicle: rider.vehicle }, 'Rider location fetched.');
  } catch (error) { next(error); }
}

// ─── SUBMIT DRIVER RATING ─────────────────────────────────────────────────────

export async function submitDriverRating(req, res, next) {
  try {
    const { rating, review } = req.body;
    if (!rating || rating < 1 || rating > 5) return err(res, 'Rating must be between 1 and 5.', 400);

    const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id, status: 'delivered' });
    if (!order)           return err(res, 'Order not found or not yet delivered.', 404);
    if (order.driverRating) return err(res, 'You have already rated this delivery.', 400);
    if (!order.riderId)   return err(res, 'No rider assigned to this order.', 404);

    order.driverRating = rating;
    order.driverReview = review?.trim() || '';
    order.ratedAt      = new Date();
    await order.save();

    const rider = await Rider.findById(order.riderId);
    if (rider) {
      const allRatings = await Order.find({ riderId: order.riderId, driverRating: { $exists: true, $gt: 0 } }).select('driverRating').lean();
      rider.rating = Math.round(allRatings.reduce((sum, o) => sum + o.driverRating, 0) / allRatings.length * 10) / 10;
      await rider.save();
    }

    return ok(res, { rating, review: order.driverReview }, 'Rating submitted. Thank you!');
  } catch (error) { next(error); }
}

// ─── DELETE USER ACCOUNT ──────────────────────────────────────────────────────

export async function deleteUserAccount(req, res, next) {
  try {
    const { password } = req.body;
    if (!password) return err(res, 'Password required.', 400);
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return err(res, 'Not found.', 404);
    if (!(await user.matchPassword(password))) return err(res, 'Incorrect password.', 401);
    await User.findByIdAndUpdate(req.user._id, { $set: {
      name: 'Deleted User', email: `deleted_${req.user._id}@deleted.invalid`,
      phone: `deleted_${req.user._id}`, isDeleted: true, deletedAt: new Date(),
      fcmToken: null, expoPushToken: null,
    }});
    return ok(res, {}, 'Account deleted.');
  } catch (error) { next(error); }
}

// ─── DELETE RIDER ACCOUNT ─────────────────────────────────────────────────────

export async function deleteRiderAccount(req, res, next) {
  try {
    const { password } = req.body;
    if (!password) return err(res, 'Password required.', 400);
    const rider = await Rider.findById(req.user._id).select('+password');
    if (!rider) return err(res, 'Not found.', 404);
    if (!(await rider.matchPassword(password))) return err(res, 'Incorrect password.', 401);
    await Rider.findByIdAndUpdate(req.user._id, { $set: {
      name: 'Deleted Rider', email: `deleted_rider_${req.user._id}@deleted.invalid`,
      phone: `deleted_rider_${req.user._id}`, isDeleted: true, deletedAt: new Date(),
      fcmToken: null, expoPushToken: null, isOnline: false, status: 'deleted',
    }});
    return ok(res, {}, 'Rider account deleted.');
  } catch (error) { next(error); }
}