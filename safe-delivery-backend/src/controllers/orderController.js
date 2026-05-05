import Order from '../models/orderModel.js';
import Rider from '../models/riderModel.js';
import Pricing from '../models/pricingModel.js';
import { ok, err } from '../utils/responseHelper.js';
import { getDistance, calculateFare, applyPromo } from '../utils/fareCalculator.js';
import { generateOTP } from '../utils/otpGenerator.js';
import User from '../models/userModel.js';
import {
  notifyNewOrder, notifyRiderFound, notifyPickedUp,
  notifyArriving, notifyDelivered, notifyRiderOrderCancelled,
} from '../services/notificationService.js';
import { validateRideCountries } from '../services/locationService.js';
import { broadcastRideRequest, emitToUser } from '../services/socketService.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const AUTO_CANCEL_MS    = 5 * 60 * 1000;
const ORDER_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_DISTANCE_MILES = 80;   // #3: max booking distance
const RIDER_RADIUS_MILES = 25;   // #4: rider assignment radius

const userLastOrderTime = new Map();

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getFareOptions(pricing) {
  return {
    baseFare: pricing.baseFare || 0,
    minFare: pricing.minFare || 2.0,
    surgeMultiplier: pricing.surgeActive ? (pricing.surgeMultiplier || 1.0) : 1.0,
  };
}

// Haversine distance in miles (used for rider radius check — no API needed)
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── AUTO CANCEL ─────────────────────────────────────────────────────────────
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
          orderId: order._id,
          message: 'No rider found. Order auto-cancelled. Please try again.',
          autoCancel: true,
        });
        console.log(`[AutoCancel] Order ${orderId} auto-cancelled.`);
      }
    } catch (e) { console.error('[AutoCancel]', e.message); }
  }, AUTO_CANCEL_MS);
}

// ─── FARE CALCULATION (no recalc on order create) ────────────────────────────
const _calculateFare = async (req, res, next) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng, promoCode } = req.body;

    if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
      return err(res, 'pickupLat, pickupLng, dropLat, dropLng are required.', 400);
    }

    // Validate same pickup/drop
    if (parseFloat(pickupLat) === parseFloat(dropLat) && parseFloat(pickupLng) === parseFloat(dropLng)) {
      return err(res, 'Pickup and drop locations cannot be the same.', 400);
    }

    const countryCheck = await validateRideCountries(
      parseFloat(pickupLat), parseFloat(pickupLng),
      parseFloat(dropLat), parseFloat(dropLng)
    );
    if (!countryCheck.valid) return err(res, countryCheck.error, 422);

    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'Pricing not configured. Contact admin.', 500);

    const distanceMiles = await getDistance(
      parseFloat(pickupLat), parseFloat(pickupLng),
      parseFloat(dropLat), parseFloat(dropLng)
    );

    // #3: Enforce max distance
    if (distanceMiles > MAX_DISTANCE_MILES) {
      return err(res, `Maximum booking distance is ${MAX_DISTANCE_MILES} miles. Your trip is ${distanceMiles.toFixed(1)} miles.`, 400);
    }

    if (distanceMiles <= 0) {
      return err(res, 'Could not calculate a valid distance. Please check your locations.', 400);
    }

    const fareOptions = getFareOptions(pricing);
    let fare = calculateFare(distanceMiles, pricing.costPerMile, fareOptions);
    const baseFareAmount = fare;

    let promoDiscount = 0;
    let promoDetails  = null;

    if (promoCode) {
      const promo = pricing.promoCodes.find(
        (p) =>
          p.code === promoCode.toUpperCase() &&
          p.isActive &&
          (!p.expiresAt || new Date() < p.expiresAt) &&
          p.usedCount < p.usageLimit &&
          (!p.userId || p.userId.toString() === req.user._id.toString())
      );
      if (promo) {
        if (fare < (promo.minOrderFare || 0)) {
          return err(res, `Minimum order fare of $${promo.minOrderFare} required for this promo code.`, 400);
        }
        const { finalFare, discountAmount } = applyPromo(fare, promo.discount, promo.type);
        promoDiscount = discountAmount;
        fare = finalFare;
        promoDetails = { code: promo.code, discount: promo.discount, type: promo.type, minOrderFare: promo.minOrderFare || 0 };
      } else {
        return err(res, 'Invalid or expired promo code.', 400);
      }
    }

    return ok(res, {
      distanceMiles,
      baseFare: baseFareAmount,
      promoDiscount,
      fare,
      promoDetails,
      costPerMile: pricing.costPerMile,
      minFare: pricing.minFare,
      baseFareConfig: pricing.baseFare,
      surgeActive: pricing.surgeActive,
      surgeMultiplier: pricing.surgeActive ? pricing.surgeMultiplier : 1.0,
      currency: pricing.currency,
      pickupCountry: countryCheck.pickupCountry,
    }, 'Fare calculated.');
  } catch (error) { next(error); }
};
export { _calculateFare as calculateFare };

// ─── CREATE ORDER ─────────────────────────────────────────────────────────────
export async function createOrder(req, res, next) {
  try {
    const { pickup, drop, parcelWeight, promoCode, notes, preCalculatedFare, preCalculatedDistance } = req.body;
    const userId = req.user._id.toString();

    // Cooldown check
    const lastOrderTime = userLastOrderTime.get(userId);
    if (lastOrderTime) {
      const elapsed = Date.now() - lastOrderTime;
      if (elapsed < ORDER_COOLDOWN_MS) {
        const remainSecs = Math.ceil((ORDER_COOLDOWN_MS - elapsed) / 1000);
        return err(res, `Please wait ${remainSecs} seconds before placing another order.`, 429);
      }
    }

    // Validate coords
    if (!pickup?.lat || !pickup?.lng || !drop?.lat || !drop?.lng) {
      return err(res, 'Valid pickup and drop coordinates are required.', 400);
    }

    if (parseFloat(pickup.lat) === parseFloat(drop.lat) && parseFloat(pickup.lng) === parseFloat(drop.lng)) {
      return err(res, 'Pickup and drop locations cannot be the same.', 400);
    }

    const countryCheck = await validateRideCountries(
      parseFloat(pickup.lat), parseFloat(pickup.lng),
      parseFloat(drop.lat),   parseFloat(drop.lng)
    );
    if (!countryCheck.valid) return err(res, countryCheck.error, 422);

    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'Pricing not configured.', 500);

    // #1: SINGLE SOURCE OF TRUTH — use pre-calculated values from client
    // Client sends: preCalculatedFare = FINAL fare (after promo already applied)
    //               preCalculatedDistance = distance in miles
    const clientSentFare = preCalculatedFare &&
      typeof preCalculatedFare === 'number' && preCalculatedFare > 0;
    const clientSentDistance = preCalculatedDistance &&
      typeof preCalculatedDistance === 'number' && preCalculatedDistance > 0;

    let distanceMiles;
    let fare;
    let promoDiscount = 0;
    let appliedPromoCode = null;

    if (clientSentDistance && clientSentFare) {
      // ── Client already calculated everything — trust it ──────────────────
      distanceMiles = Math.round(preCalculatedDistance * 100) / 100;
      fare = Math.round(preCalculatedFare * 100) / 100;

      // Validate + count promo usage (but DO NOT apply discount again)
      if (promoCode) {
        const promoIndex = pricing.promoCodes.findIndex(
          (p) =>
            p.code === promoCode.toUpperCase() &&
            p.isActive &&
            (!p.expiresAt || new Date() < p.expiresAt) &&
            p.usedCount < p.usageLimit &&
            (!p.userId || p.userId.toString() === userId)
        );
        if (promoIndex === -1) return err(res, 'Invalid or expired promo code.', 400);

        const promo = pricing.promoCodes[promoIndex];
        appliedPromoCode = promo.code;

        // Calculate discount for record-keeping only (fare is already final)
        // We store it so OrderDetail can show "original fare" vs "discounted fare"
        if (promo.type === 'flat') {
          promoDiscount = Math.round(Math.min(promo.discount, fare) * 100) / 100;
        } else {
          // percentage: discount = fare * rate / (1 - rate)  →  recovers original
          const rate = promo.discount / 100;
          promoDiscount = Math.round(fare * rate / (1 - rate) * 100) / 100;
        }

        pricing.promoCodes[promoIndex].usedCount += 1;
        await pricing.save();
      }
    } else {
      // ── Fallback: backend calculates (should rarely happen) ───────────────
      distanceMiles = await getDistance(
        parseFloat(pickup.lat), parseFloat(pickup.lng),
        parseFloat(drop.lat),   parseFloat(drop.lng)
      );
      const fareOptions = getFareOptions(pricing);
      fare = calculateFare(distanceMiles, pricing.costPerMile, fareOptions);

      if (promoCode) {
        const promoIndex = pricing.promoCodes.findIndex(
          (p) =>
            p.code === promoCode.toUpperCase() &&
            p.isActive &&
            (!p.expiresAt || new Date() < p.expiresAt) &&
            p.usedCount < p.usageLimit &&
            (!p.userId || p.userId.toString() === userId)
        );
        if (promoIndex === -1) return err(res, 'Invalid or expired promo code.', 400);

        const promo = pricing.promoCodes[promoIndex];
        if (fare < (promo.minOrderFare || 0)) {
          return err(res, `Minimum order fare of $${promo.minOrderFare} required for this promo code.`, 400);
        }
        const { finalFare, discountAmount } = applyPromo(fare, promo.discount, promo.type);
        promoDiscount = discountAmount;
        fare = finalFare;
        appliedPromoCode = promo.code;

        pricing.promoCodes[promoIndex].usedCount += 1;
        await pricing.save();
      }
    }

    // #3: Enforce max distance
    if (distanceMiles > MAX_DISTANCE_MILES) {
      return err(res, `Maximum booking distance is ${MAX_DISTANCE_MILES} miles.`, 400);
    }

    const deliveryOTP = generateOTP();

    const order = await Order.create({
      customerId: req.user._id,
      pickup,
      drop,
      parcelWeight,
      distanceMiles,
      fare,
      promoCode: appliedPromoCode,
      promoDiscount,
      deliveryOTP,
      notes,
      country: countryCheck.pickupCountry,
    });

    // Set cooldown ONLY after successful order creation
    userLastOrderTime.set(userId, Date.now());
    scheduleAutoCancel(order._id, req.user._id);

    // #4: Only notify riders within 25 miles of pickup
    const allRiders = await Rider.find({ isOnline: true, status: 'approved' }).lean();
    const nearbyRiders = allRiders.filter(rider => {
      if (!rider.currentLocation?.lat || !rider.currentLocation?.lng) return false;
      const dist = haversineMiles(
        pickup.lat, pickup.lng,
        rider.currentLocation.lat, rider.currentLocation.lng
      );
      return dist <= RIDER_RADIUS_MILES;
    });

    const riderIds = [];
    for (const rider of nearbyRiders) {
      riderIds.push(rider._id);
      if (rider.fcmToken) {
        await notifyNewOrder(rider.fcmToken, fare, distanceMiles).catch(console.error);
      }
    }

    await broadcastRideRequest(order, riderIds, 15).catch(console.error);
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalOrders: 1 } });

    return ok(res, {
      orderId: order._id,
      fare: order.fare,
      distanceMiles: order.distanceMiles,
      deliveryOTP: order.deliveryOTP,
      status: order.status,
      country: order.country,
      autoCancelIn: '5 minutes',
    }, 'Order created. Searching for riders.', 201);
  } catch (error) {
    console.error('[createOrder] Error:', error.message);
    next(error);
  }
}

// ─── ACCEPT ORDER ─────────────────────────────────────────────────────────────
export async function acceptOrder(req, res, next) {
  try {
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, status: 'searching' },
      { $set: { riderId: req.user._id, status: 'assigned', riderAssignedAt: new Date() } },
      { new: true }
    ).populate('customerId', 'name phone fcmToken');

    if (!order) return err(res, 'Order is no longer available.', 400);

    const riderInfo = await Rider.findById(req.user._id).select('name phone vehicle profilePhoto rating');
    const eta = Math.ceil(order.distanceMiles * 3);

    if (order.customerId.fcmToken) {
      await notifyRiderFound(order.customerId.fcmToken, req.user.name, eta).catch(console.error);
    }
    emitToUser(order.customerId._id.toString(), 'ride:rider_assigned', {
      orderId: order._id, rider: riderInfo, eta,
      customerName: order.customerId.name, customerPhone: order.customerId.phone,
    });

    return ok(res, { order, rider: riderInfo }, 'Order accepted.');
  } catch (error) { next(error); }
}

// ─── REJECT ORDER ─────────────────────────────────────────────────────────────
export async function rejectOrder(req, res, next) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return err(res, 'Order not found.', 404);
    if (order.status !== 'searching') return err(res, 'Order is no longer available.', 400);
    return ok(res, {}, 'Order rejected.');
  } catch (error) { next(error); }
}

// ─── PICKUP PHOTO ─────────────────────────────────────────────────────────────
export async function uploadPickupPhoto(req, res, next) {
  try {
    if (!req.file) return err(res, 'Pickup photo is required.', 400);
    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found or not assigned to you.', 404);
    if (order.status !== 'assigned') return err(res, 'Order must be in assigned status.', 400);

    order.pickupPhoto = { url: req.file.path, publicId: req.file.filename };
    order.pickupPhotoAt = new Date();
    order.status = 'picked_up';
    order.pickedUpAt = new Date();
    await order.save();
    await order.populate('customerId', 'fcmToken _id');

    if (order.customerId.fcmToken) await notifyPickedUp(order.customerId.fcmToken).catch(console.error);
    emitToUser(order.customerId._id.toString(), 'ride:picked_up', { orderId: order._id, message: 'Parcel has been picked up!' });

    return ok(res, { status: order.status, pickupPhoto: order.pickupPhoto }, 'Pickup photo uploaded.');
  } catch (error) { next(error); }
}

// ─── START TRANSIT ────────────────────────────────────────────────────────────
export async function startTransit(req, res, next) {
  try {
    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);
    if (order.status !== 'picked_up') return err(res, 'Order must be in picked_up status.', 400);

    order.status = 'in_transit';
    await order.save();
    await order.populate('customerId', 'fcmToken _id');
    const eta = Math.ceil(order.distanceMiles * 2);

    if (order.customerId.fcmToken) await notifyArriving(order.customerId.fcmToken, eta).catch(console.error);
    emitToUser(order.customerId._id.toString(), 'ride:in_transit', { orderId: order._id, eta, message: `Rider heading to drop. ETA: ${eta} mins` });

    return ok(res, { status: order.status }, 'Status updated to in_transit.');
  } catch (error) { next(error); }
}

// ─── DROP PHOTO ───────────────────────────────────────────────────────────────
export async function uploadDropPhoto(req, res, next) {
  try {
    if (!req.file) return err(res, 'Drop photo is required.', 400);
    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);
    if (order.status !== 'in_transit') return err(res, 'Order must be in_transit.', 400);

    order.dropPhoto = { url: req.file.path, publicId: req.file.filename };
    order.dropPhotoAt = new Date();
    await order.save();
    await order.populate('customerId', 'fcmToken _id');

    if (order.customerId.fcmToken) await notifyArriving(order.customerId.fcmToken, 2).catch(console.error);
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
    if (order.status !== 'in_transit') return err(res, 'Order must be in_transit.', 400);
    if (!order.dropPhoto?.url) return err(res, 'Drop photo must be uploaded first.', 400);
    if (order.deliveryOTP !== otp) return err(res, 'Invalid OTP.', 400);

    const now = new Date();
    order.otpVerified = true;
    order.otpVerifiedAt = now;
    order.status = 'delivered';
    order.deliveredAt = now;
    order.paymentStatus = 'collected';
    await order.save();

    const rider = await Rider.findById(req.user._id);
    rider.earnings.today = (rider.earnings.today || 0) + order.fare;
    rider.earnings.total = (rider.earnings.total || 0) + order.fare;
    rider.totalTrips = (rider.totalTrips || 0) + 1;
    await rider.save();

    await order.populate('customerId', 'fcmToken _id name');
    if (order.customerId.fcmToken) await notifyDelivered(order.customerId.fcmToken).catch(console.error);
    emitToUser(order.customerId._id.toString(), 'ride:delivered', {
      orderId: order._id, message: 'Parcel delivered!', fare: order.fare,
    });

    return ok(res, { status: order.status, deliveredAt: order.deliveredAt }, 'Delivery confirmed.');
  } catch (error) { next(error); }
}

// ─── CANCEL ORDER ─────────────────────────────────────────────────────────────
export async function cancelOrder(req, res, next) {
  try {
    const { cancellationReason } = req.body;
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);
    if (!['searching', 'assigned'].includes(order.status)) {
      return err(res, 'Order can only be cancelled when searching or assigned.', 400);
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = cancellationReason || 'Cancelled by customer';
    await order.save();

    if (order.riderId) {
      const rider = await Rider.findById(order.riderId);
      if (rider) {
        if (rider.fcmToken) await notifyRiderOrderCancelled(rider.fcmToken, order._id.toString()).catch(console.error);
        emitToUser(rider._id.toString(), 'ride:cancelled', { orderId: order._id, message: 'Customer cancelled the order.' });
      }
    }

    return ok(res, { status: order.status }, 'Order cancelled.');
  } catch (error) { next(error); }
}

// ─── MY ORDERS ────────────────────────────────────────────────────────────────
export async function getMyOrders(req, res, next) {
  try {
    const orders = await Order.find({ customerId: req.user._id })
      .populate('riderId', 'name phone vehicle profilePhoto rating currentLocation')
      .sort({ createdAt: -1 });
    return ok(res, { orders }, 'Orders fetched.');
  } catch (error) { next(error); }
}

// ─── GET ORDER ────────────────────────────────────────────────────────────────
// export async function getOrder(req, res, next) {
//   try {
//     const order = await Order.findById(req.params.id)
//       .populate('customerId', 'name phone email')
//       .populate('riderId', 'name phone vehicle profilePhoto rating currentLocation');

//     if (!order) return err(res, 'Order not found.', 404);
//     if (req.role === 'customer' && order.customerId._id.toString() !== req.user._id.toString()) return err(res, 'Not authorized.', 403);
//     if (req.role === 'rider' && order.riderId && order.riderId._id.toString() !== req.user._id.toString()) return err(res, 'Not authorized.', 403);

//     return ok(res, { order }, 'Order fetched.');
//   } catch (error) { next(error); }
// }

// ─── GET ORDER ────────────────────────────────────────────────────────────────
export async function getOrder(req, res, next) {
  try {
    const { id } = req.params;
    let order = null;

    if (/^[a-f\d]{24}$/i.test(id)) {
      // Full ObjectId
      order = await Order.findById(id)
        .populate('customerId', 'name phone email')
        .populate('riderId', 'name phone vehicle profilePhoto rating currentLocation');
    } else if (id.length >= 6 && id.length <= 8) {
      // Short suffix — use aggregation to avoid full collection scan
      const [result] = await Order.aggregate([
        {
          $addFields: {
            idStr: { $toLower: { $toString: '$_id' } },
          },
        },
        {
          $match: {
            idStr: { $regex: id.toLowerCase() + '$' },
          },
        },
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
    if (!['assigned', 'picked_up', 'in_transit'].includes(order.status)) {
      return err(res, 'OTP only available when order is assigned or in transit.', 400);
    }
    return ok(res, { deliveryOTP: order.deliveryOTP }, 'OTP fetched.');
  } catch (error) { next(error); }
}

// ─── RIDER LOCATION ───────────────────────────────────────────────────────────
export async function getRiderLocation(req, res, next) {
  try {
    const order = await Order.findById(req.params.id).select('riderId status customerId').lean();
    if (!order) return err(res, 'Order not found.', 404);
    if (req.role === 'customer' && order.customerId.toString() !== req.user._id.toString()) return err(res, 'Not authorized.', 403);
    if (!order.riderId) return err(res, 'No rider assigned yet.', 404);

    const rider = await Rider.findById(order.riderId).select('currentLocation name vehicle').lean();
    if (!rider) return err(res, 'Rider not found.', 404);
    return ok(res, { location: rider.currentLocation, riderName: rider.name, vehicle: rider.vehicle }, 'Rider location fetched.');
  } catch (error) { next(error); }
}

// ─── #5: SUBMIT DRIVER RATING ─────────────────────────────────────────────────
export async function submitDriverRating(req, res, next) {
  try {
    const { rating, review } = req.body;
    const { id: orderId } = req.params;

    if (!rating || rating < 1 || rating > 5) {
      return err(res, 'Rating must be between 1 and 5.', 400);
    }

    const order = await Order.findOne({ _id: orderId, customerId: req.user._id, status: 'delivered' });
    if (!order) return err(res, 'Order not found or not yet delivered.', 404);
    if (order.driverRating) return err(res, 'You have already rated this delivery.', 400);
    if (!order.riderId) return err(res, 'No rider assigned to this order.', 404);

    // Save rating on order
    order.driverRating = rating;
    order.driverReview = review?.trim() || '';
    order.ratedAt = new Date();
    await order.save();

    // Update rider's average rating
    const rider = await Rider.findById(order.riderId);
    if (rider) {
      const allRatings = await Order.find({
        riderId: order.riderId,
        driverRating: { $exists: true, $gt: 0 },
      }).select('driverRating').lean();

      const avg = allRatings.reduce((sum, o) => sum + o.driverRating, 0) / allRatings.length;
      rider.rating = Math.round(avg * 10) / 10;
      await rider.save();
    }

    return ok(res, { rating, review: order.driverReview }, 'Rating submitted. Thank you!');
  } catch (error) { next(error); }
}