const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/orderController');
const { protect, isCustomer, isRider } = require('../middleware/auth');
const { validateOrder } = require('../middleware/validate');
const { uploadPhoto } = require('../middleware/upload');

router.post('/calculate-fare', protect, isCustomer, calculateFare);
router.post('/create', protect, isCustomer, validateOrder, createOrder);
router.get('/my-orders', protect, isCustomer, getMyOrders);

router.post('/:id/accept', protect, isRider, acceptOrder);
router.post('/:id/reject', protect, isRider, rejectOrder);
router.post('/:id/pickup-photo', protect, isRider, uploadPhoto, uploadPickupPhoto);
router.post('/:id/start-transit', protect, isRider, startTransit);
router.post('/:id/drop-photo', protect, isRider, uploadPhoto, uploadDropPhoto);
router.post('/:id/verify-otp', protect, isRider, verifyDeliveryOTP);

router.post('/:id/cancel', protect, isCustomer, cancelOrder);
router.get('/:id/otp', protect, isCustomer, getDeliveryOTP);
router.get('/:id', protect, getOrder);

module.exports = router;