import User from '../models/userModel.js';
import Rider from '../models/riderModel.js';
import Order from '../models/orderModel.js';
import Pricing from '../models/pricingModel.js';
import Inquiry from '../models/inquiryModel.js';
import jwtPkg from 'jsonwebtoken';
const { sign } = jwtPkg;
import { ok, err } from '../utils/responseHelper.js';
import { sendApprovalSms, sendRejectionSms } from '../services/smsService.js';
import { sendRiderApprovedEmail } from '../services/emailService.js';
import { notifyAccountApproved, notifyAccountRejected, push } from '../services/notificationService.js';

// ─── LOGIN ───────────────────────────────────────────────────────

export async function adminLogin(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return err(res, 'Email and password are required.', 400);

    const user = await User.findOne({ email: email.toLowerCase(), role: 'admin' }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return err(res, 'Invalid credentials.', 401);
    }

    const token = sign({ id: user._id, role: 'admin' }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    return ok(res, { token, admin: { id: user._id, name: user.name, email: user.email } }, 'Admin login successful.');
  } catch (error) {
    next(error);
  }
}

// ─── DASHBOARD ───────────────────────────────────────────────────

export async function getDashboard(req, res, next) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalRiders,
      pendingApprovals,
      totalCustomers,
      totalOrders,
      todayOrders,
      onlineRiders,
      offlineRiders,
      totalInquiries,
    ] = await Promise.all([
      Rider.countDocuments(),
      Rider.countDocuments({ status: 'pending' }),
      User.countDocuments({ role: 'customer' }),
      Order.countDocuments(),
      Order.find({ createdAt: { $gte: today } }).select('fare status'),
      Rider.countDocuments({ status: 'approved', isOnline: true }),
      Rider.countDocuments({ status: 'approved', isOnline: false }),
      Inquiry.countDocuments(),
    ]);

    const todayDeliveries = todayOrders.filter((o) => o.status === 'delivered').length;
    const todayRevenue = todayOrders
      .filter((o) => o.status === 'delivered')
      .reduce((sum, o) => sum + o.fare, 0);

    const weeklyOrdersChart = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      const count = await Order.countDocuments({
        createdAt: { $gte: date, $lt: nextDate },
      });
      weeklyOrdersChart.push({ date: date.toISOString().split('T')[0], count });
    }

    const statusGroups = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const orderStatusBreakdown = {};
    statusGroups.forEach((g) => { orderStatusBreakdown[g._id] = g.count; });

    return ok(res, {
      totalRiders,
      pendingApprovals,
      onlineRiders,
      offlineRiders,
      totalCustomers,
      totalOrders,
      todayDeliveries,
      todayRevenue: Math.round(todayRevenue * 100) / 100,
      totalInquiries,
      weeklyOrdersChart,
      orderStatusBreakdown,
    }, 'Dashboard data fetched.');
  } catch (error) {
    next(error);
  }
}

// ─── RIDERS ──────────────────────────────────────────────────────

export async function getRiders(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [riders, total] = await Promise.all([
      Rider.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      Rider.countDocuments(filter),
    ]);

    return ok(res, { riders, total, page: parseInt(page), pages: Math.ceil(total / limit) }, 'Riders fetched.');
  } catch (error) {
    next(error);
  }
}

export async function getRiderById(req, res, next) {
  try {
    const rider = await Rider.findById(req.params.id);
    if (!rider) return err(res, 'Rider not found.', 404);
    return ok(res, { rider }, 'Rider fetched.');
  } catch (error) {
    next(error);
  }
}

export async function approveRider(req, res, next) {
  try {
    const rider = await Rider.findById(req.params.id);
    if (!rider) return err(res, 'Rider not found.', 404);

    if (rider.status === 'approved') {
      return err(res, 'Rider is already approved.', 400);
    }

    rider.status = 'approved';
    rider.approvedAt = new Date();
    rider.rejectionReason = undefined;
    await rider.save();

    await sendApprovalSms(rider.phone, rider.name).catch(console.error);
    await sendRiderApprovedEmail(rider.email, rider.name).catch(console.error);
    if (rider.fcmToken) {
      await notifyAccountApproved(rider.fcmToken).catch(console.error);
    }

    return ok(res, { status: rider.status }, 'Rider approved.');
  } catch (error) {
    next(error);
  }
}

export async function rejectRider(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return err(res, 'Rejection reason is required.', 400);

    const rider = await Rider.findById(req.params.id);
    if (!rider) return err(res, 'Rider not found.', 404);

    if (rider.status === 'rejected') {
      return err(res, 'Rider is already rejected.', 400);
    }

    rider.status = 'rejected';
    rider.rejectedAt = new Date();
    rider.rejectionReason = reason;
    await rider.save();

    await sendRejectionSms(rider.phone, reason).catch(console.error);
    if (rider.fcmToken) {
      await notifyAccountRejected(rider.fcmToken, reason).catch(console.error);
    }

    return ok(res, { status: rider.status }, 'Rider rejected.');
  } catch (error) {
    next(error);
  }
}

export async function banRider(req, res, next) {
  try {
    const rider = await Rider.findById(req.params.id);
    if (!rider) return err(res, 'Rider not found.', 404);

    if (rider.status === 'banned') {
      return err(res, 'Rider is already banned.', 400);
    }

    rider.status = 'banned';
    rider.isOnline = false;
    rider.bannedAt = new Date();
    await rider.save();

    if (rider.fcmToken) {
      await push(rider.fcmToken, 'Account Banned', 'Your Safe Delivery account has been banned. Contact support for more information.').catch(console.error);
    }

    return ok(res, { status: rider.status }, 'Rider banned.');
  } catch (error) {
    next(error);
  }
}

// ─── CUSTOMERS ───────────────────────────────────────────────────

export async function getCustomers(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [customers, total] = await Promise.all([
      User.find({ role: 'customer' }).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      User.countDocuments({ role: 'customer' }),
    ]);

    return ok(res, { customers, total, page: parseInt(page), pages: Math.ceil(total / limit) }, 'Customers fetched.');
  } catch (error) {
    next(error);
  }
}

export async function getCustomerById(req, res, next) {
  try {
    const customer = await User.findOne({ _id: req.params.id, role: 'customer' });
    if (!customer) return err(res, 'Customer not found.', 404);

    const orders = await Order.find({ customerId: req.params.id })
      .populate('riderId', 'name phone profilePhoto')
      .sort({ createdAt: -1 })
      .limit(20);

    return ok(res, { customer, orders }, 'Customer fetched.');
  } catch (error) {
    next(error);
  }
}

// ─── ORDERS ──────────────────────────────────────────────────────

export async function getOrders(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('customerId', 'name phone email')
        .populate('riderId', 'name phone vehicle profilePhoto')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Order.countDocuments(filter),
    ]);

    return ok(res, { orders, total, page: parseInt(page), pages: Math.ceil(total / limit) }, 'Orders fetched.');
  } catch (error) {
    next(error);
  }
}

export async function getOrderById(req, res, next) {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customerId', 'name phone email')
      .populate('riderId', 'name phone vehicle profilePhoto rating');

    if (!order) return err(res, 'Order not found.', 404);
    return ok(res, { order }, 'Order fetched.');
  } catch (error) {
    next(error);
  }
}

// ─── PRICING ─────────────────────────────────────────────────────

export async function getPricing(req, res, next) {
  try {
    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'No pricing found. Please set pricing first.', 404);
    return ok(res, { pricing }, 'Pricing fetched.');
  } catch (error) {
    next(error);
  }
}

export async function updatePricing(req, res, next) {
  try {
    const { costPerMile, baseFare, minFare, surgeMultiplier, surgeActive, currency } = req.body;

    if (costPerMile === undefined) return err(res, 'costPerMile is required.', 400);
    if (typeof costPerMile !== 'number' || costPerMile <= 0) {
      return err(res, 'costPerMile must be a positive number.', 400);
    }
    if (baseFare !== undefined && (typeof baseFare !== 'number' || baseFare < 0)) {
      return err(res, 'baseFare must be a non-negative number.', 400);
    }
    if (minFare !== undefined && (typeof minFare !== 'number' || minFare < 0)) {
      return err(res, 'minFare must be a non-negative number.', 400);
    }
    if (surgeMultiplier !== undefined && (typeof surgeMultiplier !== 'number' || surgeMultiplier < 1)) {
      return err(res, 'surgeMultiplier must be >= 1.', 400);
    }

    let pricing = await Pricing.findOne().sort({ createdAt: -1 });
    const updates = { costPerMile, updatedBy: req.user._id };
    if (baseFare !== undefined) updates.baseFare = baseFare;
    if (minFare !== undefined) updates.minFare = minFare;
    if (surgeMultiplier !== undefined) updates.surgeMultiplier = surgeMultiplier;
    if (surgeActive !== undefined) updates.surgeActive = Boolean(surgeActive);
    if (currency) updates.currency = currency;

    if (!pricing) {
      pricing = new Pricing(updates);
    } else {
      Object.assign(pricing, updates);
    }

    await pricing.save();
    return ok(res, { pricing }, 'Pricing updated.');
  } catch (error) {
    next(error);
  }
}

export async function createPromoCode(req, res, next) {
  try {
    const { code, discount, type, expiresAt, usageLimit, userId, minOrderFare } = req.body;

    if (!code || !discount || !type) return err(res, 'code, discount, and type are required.', 400);
    if (!['flat', 'percentage'].includes(type)) return err(res, 'type must be flat or percentage.', 400);
    if (type === 'percentage' && (discount <= 0 || discount > 100)) {
      return err(res, 'Percentage discount must be between 1 and 100.', 400);
    }

    let pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'Set pricing first before adding promos.', 400);

    const existing = pricing.promoCodes.find((p) => p.code === code.toUpperCase() && p.isActive);
    if (existing) return err(res, 'Active promo code already exists.', 400);

    pricing.promoCodes.push({
      code: code.toUpperCase().trim(),
      discount,
      type,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      usageLimit: usageLimit || 100,
      userId: userId || null,
      minOrderFare: minOrderFare || 0,
    });

    await pricing.save();
    return ok(res, { promoCodes: pricing.promoCodes }, 'Promo code created.', 201);
  } catch (error) {
    next(error);
  }
}

export async function deletePromoCode(req, res, next) {
  try {
    const { code } = req.params;

    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return err(res, 'Pricing not found.', 404);

    const promoIndex = pricing.promoCodes.findIndex((p) => p.code === code.toUpperCase());
    if (promoIndex === -1) return err(res, 'Promo code not found.', 404);

    pricing.promoCodes[promoIndex].isActive = false;
    await pricing.save();

    return ok(res, {}, 'Promo code deactivated.');
  } catch (error) {
    next(error);
  }
}

// ─── INQUIRIES ───────────────────────────────────────────────────

export async function getInquiries(req, res, next) {
  try {
    const { role, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (role && ['customer', 'driver'].includes(role)) filter.role = role;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [inquiries, total] = await Promise.all([
      Inquiry.find(filter)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      Inquiry.countDocuments(filter),
    ]);

    return ok(res, {
      inquiries,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
    }, 'Inquiries fetched.');
  } catch (error) {
    next(error);
  }
}

export async function getInquiryById(req, res, next) {
  try {
    const inquiry = await Inquiry.findById(req.params.id);
    if (!inquiry) return err(res, 'Inquiry not found.', 404);
    return ok(res, { inquiry }, 'Inquiry fetched.');
  } catch (error) {
    next(error);
  }
}