import { Router } from 'express';
const router = Router();
import { adminLogin, getDashboard, getRiders, getRiderById, approveRider, rejectRider, banRider, getCustomers, getCustomerById, getOrders, getOrderById, getPricing, updatePricing, createPromoCode, deletePromoCode, getInquiries, getInquiryById } from '../controllers/adminController.js';
import { protect, isAdmin } from '../middleware/auth.js';

router.post('/login', adminLogin);

router.get('/dashboard', protect, isAdmin, getDashboard);

router.get('/riders', protect, isAdmin, getRiders);
router.get('/riders/:id', protect, isAdmin, getRiderById);
router.post('/riders/:id/approve', protect, isAdmin, approveRider);
router.post('/riders/:id/reject', protect, isAdmin, rejectRider);
router.post('/riders/:id/ban', protect, isAdmin, banRider);

router.get('/customers', protect, isAdmin, getCustomers);
router.get('/customers/:id', protect, isAdmin, getCustomerById);

router.get('/orders', protect, isAdmin, getOrders);
router.get('/orders/:id', protect, isAdmin, getOrderById);

router.get('/pricing', protect, isAdmin, getPricing);
router.put('/pricing', protect, isAdmin, updatePricing);
router.post('/pricing/promo', protect, isAdmin, createPromoCode);
router.delete('/pricing/promo/:code', protect, isAdmin, deletePromoCode);

router.get('/inquiries', protect, isAdmin, getInquiries);
router.get('/inquiries/:id', protect, isAdmin, getInquiryById);

export default router;