const Rider = require('../models/riderModel');
const Order = require('../models/orderModel');
const { ok, err } = require('../utils/responseHelper');
const { notifyAdminNewRider } = require('../services/notificationService');
const User = require('../models/userModel');

// ─── KYC ────────────────────────────────────────────────────────

exports.kycStep1 = async (req, res, next) => {
  try {
    const { dob } = req.body;
    if (!dob) return err(res, 'Date of birth is required.', 400);

    const rider = await Rider.findById(req.user._id);
    rider.dob = dob;
    rider.kycStep = 2;
    await rider.save();

    return ok(res, { kycStep: rider.kycStep }, 'Step 1 saved. Proceed to document upload.');
  } catch (error) {
    next(error);
  }
};

exports.kycStep2 = async (req, res, next) => {
  try {
    const files = req.files;

    if (!files || !files.govtIdFront || !files.govtIdBack || !files.license || !files.rcBook) {
      return err(res, 'All 4 documents are required: govtIdFront, govtIdBack, license, rcBook.', 400);
    }

    const rider = await Rider.findById(req.user._id);

    rider.documents = {
      govtIdFront: {
        url: files.govtIdFront[0].path,
        publicId: files.govtIdFront[0].filename,
      },
      govtIdBack: {
        url: files.govtIdBack[0].path,
        publicId: files.govtIdBack[0].filename,
      },
      license: {
        url: files.license[0].path,
        publicId: files.license[0].filename,
      },
      rcBook: {
        url: files.rcBook[0].path,
        publicId: files.rcBook[0].filename,
      },
    };

    rider.kycStep = 3;
    await rider.save();

    return ok(res, { kycStep: rider.kycStep }, 'Documents uploaded. Proceed to vehicle info.');
  } catch (error) {
    next(error);
  }
};

exports.kycStep3 = async (req, res, next) => {
  try {
    const { type, plate, model, color } = req.body;
    const validTypes = ['motorcycle', 'bicycle', 'car'];

    if (!type || !validTypes.includes(type)) {
      return err(res, `Vehicle type must be one of: ${validTypes.join(', ')}.`, 400);
    }
    if (!plate || !model || !color) {
      return err(res, 'plate, model, and color are required.', 400);
    }

    const rider = await Rider.findById(req.user._id);
    rider.vehicle = { type, plate, model, color };
    rider.kycCompleted = true;
    rider.status = 'pending';
    await rider.save();

    // Notify admin
    const admins = await User.find({ role: 'admin', fcmToken: { $ne: null } });
    for (const admin of admins) {
      await notifyAdminNewRider(admin.fcmToken).catch(console.error);
    }

    return ok(res, { status: rider.status, kycCompleted: rider.kycCompleted }, 'KYC complete. Your application is under review.');
  } catch (error) {
    next(error);
  }
};

exports.getKycStatus = async (req, res, next) => {
  try {
    const rider = await Rider.findById(req.user._id).select('kycStep kycCompleted status');
    return ok(res, rider, 'KYC status fetched.');
  } catch (error) {
    next(error);
  }
};

// ─── ONLINE STATUS ──────────────────────────────────────────────

exports.toggleOnline = async (req, res, next) => {
  try {
    const rider = await Rider.findById(req.user._id);

    if (rider.status !== 'approved') {
      return err(res, 'You must be approved to go online.', 403);
    }

    rider.isOnline = !rider.isOnline;
    await rider.save();

    return ok(res, { isOnline: rider.isOnline }, `You are now ${rider.isOnline ? 'online' : 'offline'}.`);
  } catch (error) {
    next(error);
  }
};

// ─── DASHBOARD ──────────────────────────────────────────────────

exports.getDashboard = async (req, res, next) => {
  try {
    const rider = await Rider.findById(req.user._id).select(
      'isOnline status earnings rating totalTrips vehicle name phone'
    );
    return ok(res, rider, 'Dashboard fetched.');
  } catch (error) {
    next(error);
  }
};

// ─── LOCATION ───────────────────────────────────────────────────

exports.updateLocation = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) return err(res, 'lat and lng are required.', 400);

    await Rider.findByIdAndUpdate(req.user._id, {
      currentLocation: { lat: parseFloat(lat), lng: parseFloat(lng) },
    });

    return ok(res, {}, 'Location updated.');
  } catch (error) {
    next(error);
  }
};

// ─── EARNINGS ───────────────────────────────────────────────────

exports.getEarnings = async (req, res, next) => {
  try {
    const { period = 'daily' } = req.query;
    const riderId = req.user._id;

    const now = new Date();
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

    const orders = await Order.find({
      riderId,
      status: 'delivered',
      deliveredAt: { $gte: startDate },
    }).select('fare deliveredAt distanceMiles');

    const totalEarned = orders.reduce((sum, o) => sum + o.fare, 0);
    const totalMiles = orders.reduce((sum, o) => sum + o.distanceMiles, 0);

    const rider = await Rider.findById(riderId).select('earnings');

    return ok(res, {
      period,
      ordersCount: orders.length,
      periodEarnings: Math.round(totalEarned * 100) / 100,
      periodMiles: Math.round(totalMiles * 100) / 100,
      allTimeEarnings: rider.earnings,
      orders,
    }, 'Earnings fetched.');
  } catch (error) {
    next(error);
  }
};

// ─── ORDERS ─────────────────────────────────────────────────────

exports.getRiderOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ riderId: req.user._id })
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 });

    return ok(res, { orders }, 'Orders fetched.');
  } catch (error) {
    next(error);
  }
};

// ─── PROFILE ────────────────────────────────────────────────────

exports.getRiderProfile = async (req, res, next) => {
  try {
    const rider = await Rider.findById(req.user._id).select('-password');
    return ok(res, { rider }, 'Profile fetched.');
  } catch (error) {
    next(error);
  }
};

exports.updateRiderProfile = async (req, res, next) => {
  try {
    const { name, email, dob } = req.body;
    const updates = {};

    if (name) updates.name = name.trim();
    if (email) updates.email = email.toLowerCase().trim();
    if (dob) updates.dob = dob;

    const rider = await Rider.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).select('-password');

    return ok(res, { rider }, 'Profile updated.');
  } catch (error) {
    next(error);
  }
};