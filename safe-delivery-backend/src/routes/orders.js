import { Router } from 'express';
const router = Router();
import {
  calculateFare,
  createOrder,
  acceptOrder,
  rejectOrder,
  uploadPickupPhoto,
  startTransit,
  uploadDropPhoto,
  verifyDeliveryOTP,
  cancelOrder,
  getMyOrders,
  getOrder,
  getDeliveryOTP,
  getRiderLocation,
  submitDriverRating,
} from '../controllers/orderController.js';
import { protect, isCustomer, isRider } from '../middleware/auth.js';
import { validateOrder } from '../middleware/validate.js';
import { uploadPhoto } from '../middleware/upload.js';
import Pricing from '../models/pricingModel.js';

const noCache = (req, res, next) => { res.set('Cache-Control','no-store,no-cache,must-revalidate'); res.set('Pragma','no-cache'); res.set('Expires','0'); next(); };

// ── Public pricing (no auth needed) ──────────────────────────────────────────
router.get('/pricing', async (req, res) => {
  try {
    const pricing = await Pricing.findOne().sort({ createdAt: -1 });
    if (!pricing) return res.json({ success: true, data: { pricing: null } });
    return res.json({
      success: true,
      data: {
        pricing: {
          costPerMile:     pricing.costPerMile,
          baseFare:        pricing.baseFare,
          minFare:         pricing.minFare,
          surgeActive:     pricing.surgeActive,
          surgeMultiplier: pricing.surgeMultiplier,
          currency:        pricing.currency,
          promoCodes: (pricing.promoCodes || [])
            .filter(p => {
              if (!p.isActive) return false;
              if (p.expiresAt && new Date() >= new Date(p.expiresAt)) return false;
              if (p.usageLimit > 0 && p.usedCount >= p.usageLimit) return false;
              // Exclude user-specific promos (null, undefined, or empty string is OK)
              if (p.userId && p.userId.toString() !== 'null') return false;
              return true;
            })
            .map(p => ({
              code:         p.code,
              discount:     p.discount,
              type:         p.type,
              minOrderFare: p.minOrderFare || 0,
            })),
        }
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false });
  }
});

// ── Protected routes ──────────────────────────────────────────────────────────
router.post('/calculate-fare', protect, isCustomer, calculateFare);
router.post('/create', protect, isCustomer, validateOrder, createOrder);
router.get('/my-orders', protect, isCustomer, noCache, getMyOrders);

router.post('/:id/accept', protect, isRider, acceptOrder);
router.post('/:id/reject', protect, isRider, rejectOrder);
router.post('/:id/pickup-photo', protect, isRider, uploadPhoto, uploadPickupPhoto);
router.post('/:id/start-transit', protect, isRider, startTransit);
router.post('/:id/drop-photo', protect, isRider, uploadPhoto, uploadDropPhoto);
router.post('/:id/verify-otp', protect, isRider, verifyDeliveryOTP);

router.post('/:id/cancel', protect, isCustomer, cancelOrder);
router.get('/:id/otp', protect, isCustomer, noCache, getDeliveryOTP);
router.get('/:id/rider-location', protect, isCustomer, getRiderLocation);

router.post('/:id/rate-driver', protect, isCustomer, submitDriverRating);

router.get('/:id', protect, noCache, getOrder);

export default router;