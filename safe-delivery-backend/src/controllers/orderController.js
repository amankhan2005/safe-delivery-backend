import Order from '../models/orderModel.js';
import Rider from '../models/riderModel.js';
import Pricing from '../models/pricingModel.js';
import { ok, err } from '../utils/responseHelper.js';
import { getDistance, calculateFare, applyPromo } from '../utils/fareCalculator.js';
import { generateOTP } from '../utils/otpGenerator.js';
import User from '../models/userModel.js';
import { notifyNewOrder, notifyRiderFound, notifyPickedUp, notifyArriving, notifyDelivered, notifyRiderOrderCancelled } from '../services/notificationService.js';

// ─── FARE CALCULATION ───────────────────────────────────────────

const _calculateFare = async (req, res, next) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng, promoCode } = req.body;

    if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
      return err(res, 'pickupLat, pickupLng, dropLat, dropLng are required.', 400);
    }

    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'Pricing not configured. Contact admin.', 500);

    const distanceMiles = await getDistance(
      parseFloat(pickupLat), parseFloat(pickupLng),
      parseFloat(dropLat), parseFloat(dropLng)
    );

    let fare = calculateFare(distanceMiles, pricing.costPerMile);
    let promoDiscount = 0;
    let promoDetails = null;

    if (promoCode) {
      const promo = pricing.promoCodes.find(
        (p) => p.code === promoCode.toUpperCase() &&
          p.isActive &&
          (!p.expiresAt || new Date() < p.expiresAt) &&
          p.usedCount < p.usageLimit
      );

      if (promo) {
        const { finalFare, discountAmount } = applyPromo(fare, promo.discount, promo.type);
        promoDiscount = discountAmount;
        fare = finalFare;
        promoDetails = { code: promo.code, discount: promo.discount, type: promo.type };
      } else {
        return err(res, 'Invalid or expired promo code.', 400);
      }
    }

    return ok(res, {
      distanceMiles,
      baseFare: calculateFare(distanceMiles, pricing.costPerMile),
      promoDiscount,
      fare,
      promoDetails,
      costPerMile: pricing.costPerMile,
      currency: pricing.currency,
    }, 'Fare calculated.');
  } catch (error) {
    next(error);
  }
};
export { _calculateFare as calculateFare };

// ─── CREATE ORDER ───────────────────────────────────────────────

export async function createOrder(req, res, next) {
  try {
    const { pickup, drop, parcelWeight, promoCode, notes } = req.body;

    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'Pricing not configured.', 500);

    const distanceMiles = await getDistance(
      parseFloat(pickup.lat), parseFloat(pickup.lng),
      parseFloat(drop.lat), parseFloat(drop.lng)
    );

    let fare = calculateFare(distanceMiles, pricing.costPerMile);
    let promoDiscount = 0;
    let appliedPromoCode = null;

    if (promoCode) {
      const promoIndex = pricing.promoCodes.findIndex(
        (p) =>
          p.code === promoCode.toUpperCase() &&
          p.isActive &&
          (!p.expiresAt || new Date() < p.expiresAt) &&
          p.usedCount < p.usageLimit
      );

      if (promoIndex === -1) return err(res, 'Invalid or expired promo code.', 400);

      const promo = pricing.promoCodes[promoIndex];
      const { finalFare, discountAmount } = applyPromo(fare, promo.discount, promo.type);
      promoDiscount = discountAmount;
      fare = finalFare;
      appliedPromoCode = promo.code;

      pricing.promoCodes[promoIndex].usedCount += 1;
      await pricing.save();
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
    });

    // Notify available riders
    const availableRiders = await Rider.find({ isOnline: true, status: 'approved' });
    for (const rider of availableRiders) {
      if (rider.fcmToken) {
        await notifyNewOrder(rider.fcmToken, fare, distanceMiles).catch(console.error);
      }
    }

    // Increment customer totalOrders
    await User.findByIdAndUpdate(req.user._id, { $inc: { totalOrders: 1 } });

    return ok(res, {
      orderId: order._id,
      fare: order.fare,
      distanceMiles: order.distanceMiles,
      deliveryOTP: order.deliveryOTP,
      status: order.status,
    }, 'Order created. Searching for riders.', 201);
  } catch (error) {
    next(error);
  }
}

// ─── ACCEPT ORDER ───────────────────────────────────────────────

export async function acceptOrder(req, res, next) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return err(res, 'Order not found.', 404);

    if (order.status !== 'searching') {
      return err(res, 'Order is no longer available.', 400);
    }

    order.riderId = req.user._id;
    order.status = 'assigned';
    order.riderAssignedAt = new Date();
    await order.save();

    await order.populate('customerId', 'name fcmToken');

    // Fetch full rider info including profile photo for customer
    const riderInfo = await Rider.findById(req.user._id)
      .select('name phone vehicle profilePhoto rating');

    const eta = Math.ceil(order.distanceMiles * 3);
    if (order.customerId.fcmToken) {
      await notifyRiderFound(order.customerId.fcmToken, req.user.name, eta).catch(console.error);
    }

    return ok(res, { order, rider: riderInfo }, 'Order accepted.');
  } catch (error) {
    next(error);
  }
}

// ─── REJECT ORDER ───────────────────────────────────────────────

export async function rejectOrder(req, res, next) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return err(res, 'Order not found.', 404);

    if (order.status !== 'searching') {
      return err(res, 'Order is no longer available.', 400);
    }

    // Order stays in searching — just return
    return ok(res, {}, 'Order rejected. It will remain available for other riders.');
  } catch (error) {
    next(error);
  }
}

// ─── PICKUP PHOTO ───────────────────────────────────────────────

export async function uploadPickupPhoto(req, res, next) {
  try {
    if (!req.file) return err(res, 'Pickup photo is required.', 400);

    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found or not assigned to you.', 404);

    if (order.status !== 'assigned') {
      return err(res, 'Order must be in assigned status to upload pickup photo.', 400);
    }

    order.pickupPhoto = {
      url: req.file.path,
      publicId: req.file.filename,
    };
    order.pickupPhotoAt = new Date();
    order.status = 'picked_up';
    order.pickedUpAt = new Date();
    await order.save();

    await order.populate('customerId', 'fcmToken');
    if (order.customerId.fcmToken) {
      await notifyPickedUp(order.customerId.fcmToken).catch(console.error);
    }

    return ok(res, { status: order.status, pickupPhoto: order.pickupPhoto }, 'Pickup photo uploaded. Status updated to picked_up.');
  } catch (error) {
    next(error);
  }
}

// ─── START TRANSIT ───────────────────────────────────────────────

export async function startTransit(req, res, next) {
  try {
    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);

    if (order.status !== 'picked_up') {
      return err(res, 'Order must be in picked_up status to start transit.', 400);
    }

    order.status = 'in_transit';
    await order.save();

    await order.populate('customerId', 'fcmToken');
    if (order.customerId.fcmToken) {
      const eta = Math.ceil(order.distanceMiles * 2);
      await notifyArriving(order.customerId.fcmToken, eta).catch(console.error);
    }

    return ok(res, { status: order.status }, 'Status updated to in_transit.');
  } catch (error) {
    next(error);
  }
}

// ─── DROP PHOTO ──────────────────────────────────────────────────

export async function uploadDropPhoto(req, res, next) {
  try {
    if (!req.file) return err(res, 'Drop photo is required.', 400);

    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);

    if (order.status !== 'in_transit') {
      return err(res, 'Order must be in_transit to upload drop photo.', 400);
    }

    order.dropPhoto = {
      url: req.file.path,
      publicId: req.file.filename,
    };
    order.dropPhotoAt = new Date();
    await order.save();

    await order.populate('customerId', 'fcmToken');
    if (order.customerId.fcmToken) {
      await notifyArriving(order.customerId.fcmToken, 2).catch(console.error);
    }

    return ok(res, { dropPhoto: order.dropPhoto }, 'Drop photo uploaded. Ready for OTP verification.');
  } catch (error) {
    next(error);
  }
}

// ─── VERIFY DELIVERY OTP ────────────────────────────────────────

export async function verifyDeliveryOTP(req, res, next) {
  try {
    const { otp } = req.body;
    if (!otp) return err(res, 'OTP is required.', 400);

    const order = await Order.findOne({ _id: req.params.id, riderId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);

    if (order.status !== 'in_transit') {
      return err(res, 'Order must be in_transit to verify OTP.', 400);
    }

    if (!order.dropPhoto || !order.dropPhoto.url) {
      return err(res, 'Drop photo must be uploaded before verifying OTP.', 400);
    }

    if (order.deliveryOTP !== otp) {
      return err(res, 'Invalid OTP. Please check with the customer.', 400);
    }

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

    await order.populate('customerId', 'fcmToken name');
    if (order.customerId.fcmToken) {
      await notifyDelivered(order.customerId.fcmToken).catch(console.error);
    }

    return ok(res, { status: order.status, deliveredAt: order.deliveredAt }, 'Delivery confirmed. Payment collected.');
  } catch (error) {
    next(error);
  }
}

// ─── CANCEL ORDER ───────────────────────────────────────────────

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
      if (rider && rider.fcmToken) {
        await notifyRiderOrderCancelled(rider.fcmToken, order._id.toString()).catch(console.error);
      }
    }

    return ok(res, { status: order.status }, 'Order cancelled.');
  } catch (error) {
    next(error);
  }
}

// ─── MY ORDERS ──────────────────────────────────────────────────

export async function getMyOrders(req, res, next) {
  try {
    const orders = await Order.find({ customerId: req.user._id })
      .populate('riderId', 'name phone vehicle profilePhoto rating currentLocation')
      .sort({ createdAt: -1 });

    return ok(res, { orders }, 'Orders fetched.');
  } catch (error) {
    next(error);
  }
}

// ─── GET ORDER ──────────────────────────────────────────────────

export async function getOrder(req, res, next) {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customerId', 'name phone email')
      .populate('riderId', 'name phone vehicle profilePhoto rating');

    if (!order) return err(res, 'Order not found.', 404);

    if (
      req.role === 'customer' && order.customerId._id.toString() !== req.user._id.toString()
    ) {
      return err(res, 'Not authorized.', 403);
    }

    if (
      req.role === 'rider' &&
      order.riderId &&
      order.riderId._id.toString() !== req.user._id.toString()
    ) {
      return err(res, 'Not authorized.', 403);
    }

    return ok(res, { order }, 'Order fetched.');
  } catch (error) {
    next(error);
  }
}

// ─── GET DELIVERY OTP ──────────────────────────────────────────

export async function getDeliveryOTP(req, res, next) {
  try {
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id });
    if (!order) return err(res, 'Order not found.', 404);

    if (!['assigned', 'picked_up', 'in_transit'].includes(order.status)) {
      return err(res, 'OTP is only available when order is assigned or in transit.', 400);
    }

    return ok(res, { deliveryOTP: order.deliveryOTP }, 'Delivery OTP fetched. Share this with the rider on delivery.');
  } catch (error) {
    next(error);
  }
}