import { Router } from 'express';
const router = Router();
import { submitInquiry } from '../controllers/inquiryController.js';

// POST /api/inquiry
router.post('/', submitInquiry);

export default router;