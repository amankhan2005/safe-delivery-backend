import { Router } from 'express';
const router = Router();
import { kycStep1, kycStep2, kycStep3, getKycStatus, toggleOnline, getDashboard, updateLocation, getEarnings, getRiderOrders, getRiderProfile, updateRiderProfile, uploadProfilePhoto } from '../controllers/riderController.js';
import { protect, isRider } from '../middleware/auth.js';
import { uploadKYC, uploadPhoto } from '../middleware/upload.js';
const noCache = (req, res, next) => { res.set('Cache-Control','no-store,no-cache,must-revalidate'); res.set('Pragma','no-cache'); res.set('Expires','0'); next(); };

router.post('/kyc/step1', protect, isRider, kycStep1);
router.post('/kyc/step2', protect, isRider, uploadKYC, kycStep2);
router.post('/kyc/step3', protect, isRider, kycStep3);
router.get('/kyc-status', protect, isRider, getKycStatus);

router.post('/toggle-online', protect, isRider, toggleOnline);
router.get('/dashboard', protect, isRider, noCache, getDashboard);
router.post('/update-location', protect, isRider, updateLocation);
router.get('/earnings', protect, isRider, noCache, getEarnings);
router.get('/orders', protect, isRider, noCache, getRiderOrders);
router.get('/profile', protect, isRider, getRiderProfile);
router.put('/profile', protect, isRider, updateRiderProfile);
router.post('/profile/photo', protect, isRider, uploadPhoto, uploadProfilePhoto);

export default router;