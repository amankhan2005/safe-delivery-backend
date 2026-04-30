import { Router } from 'express';
const router = Router();
import { sendNotification } from '../controllers/notificationController.js';
import { protect, isAdmin } from '../middleware/auth.js';

router.post('/send', protect, isAdmin, sendNotification);

export default router;