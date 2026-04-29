const express = require('express');
const router = express.Router();
const {
  kycStep1,
  kycStep2,
  kycStep3,
  getKycStatus,
  toggleOnline,
  getDashboard,
  updateLocation,
  getEarnings,
  getRiderOrders,
  getRiderProfile,
  updateRiderProfile,
} = require('../controllers/riderController');
const { protect, isRider } = require('../middleware/auth');
const { uploadKYC } = require('../middleware/upload');

router.post('/kyc/step1', protect, isRider, kycStep1);
router.post('/kyc/step2', protect, isRider, uploadKYC, kycStep2);
router.post('/kyc/step3', protect, isRider, kycStep3);
router.get('/kyc-status', protect, isRider, getKycStatus);

router.post('/toggle-online', protect, isRider, toggleOnline);
router.get('/dashboard', protect, isRider, getDashboard);
router.post('/update-location', protect, isRider, updateLocation);
router.get('/earnings', protect, isRider, getEarnings);
router.get('/orders', protect, isRider, getRiderOrders);
router.get('/profile', protect, isRider, getRiderProfile);
router.put('/profile', protect, isRider, updateRiderProfile);

module.exports = router;