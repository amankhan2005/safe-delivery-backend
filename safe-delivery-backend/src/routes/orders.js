import { Router } from 'express';
const router = Router();
import { calculateFare, createOrder, acceptOrder, rejectOrder, uploadPickupPhoto, startTransit, uploadDropPhoto, verifyDeliveryOTP, cancelOrder, getMyOrders, getOrder, getDeliveryOTP } from '../controllers/orderController.js';
import { protect, isCustomer, isRider } from '../middleware/auth.js';
import { validateOrder } from '../middleware/validate.js';
import { uploadPhoto } from '../middleware/upload.js';

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

export default router;