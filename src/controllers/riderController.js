import Rider from '../models/riderModel.js';
import Order from '../models/orderModel.js';
import { ok, err } from '../utils/responseHelper.js';
import { notifyAdminNewRider } from '../services/notificationService.js';
import User from '../models/userModel.js';
import { emitToUser } from '../services/socketService.js';
import cloudinaryConfig from '../config/cloudinary.js';

const ACTIVE_STATUSES = ['assigned', 'picked_up', 'in_transit'];

// ─── KYC ─────────────────────────────────────────────────────────────────────

export async function kycStep1(req, res, next) {
  try {
    const { dob } = req.body;
    if (!dob) return err(res, 'Date of birth is required.', 400);
    const rider = await Rider.findById(req.user._id);
    rider.dob     = dob;
    rider.kycStep = 2;
    await rider.save();
    return ok(res, { kycStep: rider.kycStep }, 'Step 1 saved. Proceed to document upload.');
  } catch (error) { next(error); }
}

export async function kycStep2(req, res, next) {
  try {
    const files = req.files;
    if (!files?.govtIdFront || !files?.govtIdBack || !files?.license || !files?.rcBook)
      return err(res, 'All 4 documents are required: govtIdFront, govtIdBack, license, rcBook.', 400);

    const rider = await Rider.findById(req.user._id);
    rider.documents = {
      govtIdFront: { url: files.govtIdFront[0].path, publicId: files.govtIdFront[0].filename },
      govtIdBack:  { url: files.govtIdBack[0].path,  publicId: files.govtIdBack[0].filename  },
      license:     { url: files.license[0].path,     publicId: files.license[0].filename     },
      rcBook:      { url: files.rcBook[0].path,      publicId: files.rcBook[0].filename      },
    };
    rider.kycStep = 3;
    await rider.save();
    return ok(res, { kycStep: rider.kycStep }, 'Documents uploaded. Proceed to vehicle info.');
  } catch (error) { next(error); }
}

export async function kycStep3(req, res, next) {
  try {
    const { type, plate, model, color } = req.body;
    const validTypes = ['motorcycle', 'bicycle', 'car'];
    if (!type || !validTypes.includes(type))
      return err(res, `Vehicle type must be one of: ${validTypes.join(', ')}.`, 400);
    if (!plate || !model || !color)
      return err(res, 'plate, model, and color are required.', 400);

    const rider = await Rider.findById(req.user._id);
    rider.vehicle      = { type, plate, model, color };
    rider.kycCompleted = true;
    rider.status       = 'pending';
    await rider.save();

    const admins = await User.find({ role: 'admin', fcmToken: { $ne: null } });
    for (const admin of admins) await notifyAdminNewRider(admin.fcmToken).catch(console.error);

    return ok(res, { status: rider.status, kycCompleted: rider.kycCompleted }, 'KYC complete. Your application is under review.');
  } catch (error) { next(error); }
}

export async function getKycStatus(req, res, next) {
  try {
    const rider = await Rider.findById(req.user._id).select('kycStep kycCompleted status');
    return ok(res, rider, 'KYC status fetched.');
  } catch (error) { next(error); }
}

// ─── ONLINE STATUS ────────────────────────────────────────────────────────────

export async function toggleOnline(req, res, next) {
  try {
    const rider = await Rider.findById(req.user._id);
    if (rider.status !== 'approved')
      return err(res, 'You must be approved to go online.', 403);

    // Security: prevent going offline mid-delivery
    if (rider.isOnline) {
      const activeOrder = await Order.findOne({ riderId: rider._id, status: { $in: ACTIVE_STATUSES } }).select('_id status').lean();
      if (activeOrder)
        return err(res, `Cannot go offline while delivering order (${activeOrder.status}). Complete or cancel it first.`, 409);
    }

    rider.isOnline = !rider.isOnline;
    await rider.save();
    return ok(res, { isOnline: rider.isOnline }, `You are now ${rider.isOnline ? 'online' : 'offline'}.`);
  } catch (error) { next(error); }
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

export async function getDashboard(req, res, next) {
  try {
    const rider = await Rider.findById(req.user._id).select(
      'isOnline status earnings rating totalTrips vehicle name phone'
    );
    return ok(res, rider, 'Dashboard fetched.');
  } catch (error) { next(error); }
}

// ─── LOCATION ─────────────────────────────────────────────────────────────────

export async function updateLocation(req, res, next) {
  try {
    const { lat, lng, orderId } = req.body;
    if (lat === undefined || lng === undefined)
      return err(res, 'lat and lng are required.', 400);

    await Rider.findByIdAndUpdate(req.user._id, {
      currentLocation: { lat: parseFloat(lat), lng: parseFloat(lng) },
    });

    if (orderId) {
      // Security: verify orderId belongs to this rider
      const order = await Order.findOne({
        _id: orderId,
        riderId: req.user._id,
        status: { $in: ACTIVE_STATUSES },
      }).select('customerId status').lean();

      if (order) {
        emitToUser(order.customerId.toString(), 'rider:location', {
          lat: parseFloat(lat), lng: parseFloat(lng),
          riderId: req.user._id, orderId,
        });
      }
    }

    return ok(res, {}, 'Location updated.');
  } catch (error) { next(error); }
}

// ─── EARNINGS ─────────────────────────────────────────────────────────────────

export async function getEarnings(req, res, next) {
  try {
    const { period = 'daily' } = req.query;
    const riderId = req.user._id;
    const now     = new Date();
    let startDate;

    if (period === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'yearly') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      return err(res, 'period must be daily, monthly, or yearly.', 400);
    }

    const [orders, rider] = await Promise.all([
      Order.find({ riderId, status: 'delivered', deliveredAt: { $gte: startDate } })
        .select('fare deliveredAt distanceMiles pickup drop status').sort({ deliveredAt: -1 }),
      Rider.findById(riderId).select('earnings'),
    ]);

    const totalEarned = orders.reduce((sum, o) => sum + o.fare, 0);
    const totalMiles  = orders.reduce((sum, o) => sum + o.distanceMiles, 0);

    return ok(res, {
      period,
      ordersCount:     orders.length,
      periodEarnings:  Math.round(totalEarned * 100) / 100,
      periodMiles:     Math.round(totalMiles  * 100) / 100,
      allTimeEarnings: rider.earnings,
      orders,
    }, 'Earnings fetched.');
  } catch (error) { next(error); }
}

// ─── GET RIDER ORDERS ─────────────────────────────────────────────────────────
// Returns:
//   activeOrder: the rider's current active order (if any) — used by client
//                to instantly restore state on boot without extra API call.
//   orders:      completed/cancelled history (last 30).
//
// Security: only returns orders belonging to req.user._id.

export async function getRiderOrders(req, res, next) {
  try {
    const rider = await Rider.findById(req.user._id).select('isOnline status').lean();
    if (!rider) return err(res, 'Rider not found.', 404);

    // Run active order + history queries in parallel
    const [activeOrder, historyOrders] = await Promise.all([
      Order.findOne({ riderId: req.user._id, status: { $in: ACTIVE_STATUSES } })
        .populate('customerId', 'name phone')
        .lean(),
      Order.find({ riderId: req.user._id, status: { $in: ['delivered', 'cancelled'] } })
        .select('status pickup drop fare distanceMiles parcelWeight notes riderId customerId pickupPhoto dropPhoto createdAt deliveredAt')
        .populate('customerId', 'name phone')
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),
    ]);

    // Available searching orders — only when rider is free and online
    let searchingOrders = [];
    if (rider.isOnline && rider.status === 'approved' && !activeOrder) {
      searchingOrders = await Order.find({
        status: 'searching',
        $or: [{ riderId: null }, { riderId: { $exists: false } }],
      })
        .select('status pickup drop fare distanceMiles parcelWeight notes customerId createdAt')
        .populate('customerId', 'name phone')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
    }

    console.log(`[getRiderOrders] Rider ${req.user._id} — active: ${activeOrder?._id ?? 'none'}, history: ${historyOrders.length}`);

    return ok(res, {
      activeOrder:  activeOrder || null,     // ← KEY FIELD for client state recovery
      orders:       [...searchingOrders, ...historyOrders],
    }, 'Orders fetched.');
  } catch (error) { next(error); }
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────

export async function getRiderProfile(req, res, next) {
  try {
    const rider = await Rider.findById(req.user._id).select('-password');
    return ok(res, { rider }, 'Profile fetched.');
  } catch (error) { next(error); }
}

export async function updateRiderProfile(req, res, next) {
  try {
    const { name, email, dob } = req.body;
    const updates = {};
    if (name)  updates.name  = name.trim();
    if (email) updates.email = email.toLowerCase().trim();
    if (dob)   updates.dob   = dob;

    const rider = await Rider.findByIdAndUpdate(req.user._id, updates, {
      new: true, runValidators: true,
    }).select('-password');
    return ok(res, { rider }, 'Profile updated.');
  } catch (error) { next(error); }
}

export async function uploadProfilePhoto(req, res, next) {
  try {
    if (!req.file) return err(res, 'Profile photo is required.', 400);
    const rider = await Rider.findById(req.user._id);

    if (rider.profilePhoto?.publicId) {
      const { cloudinary } = cloudinaryConfig;
      await cloudinary.uploader.destroy(rider.profilePhoto.publicId).catch(console.error);
    }

    rider.profilePhoto = { url: req.file.path, publicId: req.file.filename };
    await rider.save();
    return ok(res, { profilePhoto: rider.profilePhoto }, 'Profile photo updated.');
  } catch (error) { next(error); }
}