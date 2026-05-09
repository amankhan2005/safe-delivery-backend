import { Router } from 'express';
import {
  kycStep1, kycStep2, kycStep3, getKycStatus,
  toggleOnline, getDashboard, updateLocation,
  getEarnings, getRiderOrders, getRiderProfile,
  updateRiderProfile, uploadProfilePhoto as uploadProfilePhotoCtrl,
} from '../controllers/riderController.js';
import {
  acceptOrder, rejectOrder, getOrder,
  uploadPickupPhoto, startTransit, uploadDropPhoto,
  verifyDeliveryOTP,
} from '../controllers/orderController.js';
import { protect, isRider } from '../middleware/auth.js';
import {
  uploadKYC,
  uploadPhoto,
  uploadProfilePhoto as uploadProfilePhotoMiddleware,
} from '../middleware/upload.js';

const router = Router();

const noCache = (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

router.post('/kyc/step1', protect, isRider, kycStep1);
router.post('/kyc/step2', protect, isRider, uploadKYC, kycStep2);
router.post('/kyc/step3', protect, isRider, kycStep3);
router.get('/kyc-status', protect, isRider, getKycStatus);

router.post('/toggle-online',   protect, isRider, toggleOnline);
router.get('/dashboard',        protect, isRider, noCache, getDashboard);
router.post('/update-location', protect, isRider, updateLocation);
router.get('/earnings',         protect, isRider, noCache, getEarnings);

router.get('/orders', protect, isRider, noCache, getRiderOrders);

router.post('/orders/:id/accept',        protect, isRider, acceptOrder);
router.post('/orders/:id/reject',        protect, isRider, rejectOrder);
router.get('/orders/:id',                protect, isRider, noCache, getOrder);
router.post('/orders/:id/pickup-photo',  protect, isRider, uploadPhoto, uploadPickupPhoto);
router.post('/orders/:id/start-transit', protect, isRider, startTransit);
router.post('/orders/:id/drop-photo',    protect, isRider, uploadPhoto, uploadDropPhoto);
router.post('/orders/:id/verify-otp',    protect, isRider, verifyDeliveryOTP);

router.get('/profile',        protect, isRider, getRiderProfile);
router.put('/profile',        protect, isRider, updateRiderProfile);
router.post('/profile/photo', protect, isRider, uploadProfilePhotoMiddleware, uploadProfilePhotoCtrl);

export default router;