/**
 * routes/notifications.js
 * UPDATE EXISTING FILE
 * Path: src/routes/notifications.js
 *
 * Added routes:
 *   POST /api/notifications/expo-token  → save Expo push token
 *   POST /api/notifications/broadcast   → admin broadcast
 *
 * Existing routes unchanged:
 *   GET    /api/notifications
 *   PATCH  /api/notifications/:id/read
 *   POST   /api/notifications/send
 */

import { Router } from 'express';
import {
  sendNotification,
  getNotifications,
  markNotificationRead,
  saveExpoPushToken,
  broadcastNotification,
} from '../controllers/notificationController.js';
import { protect, isAdmin } from '../middleware/auth.js';

const router = Router();

// ─── Existing routes ──────────────────────────────────────────────────────────
router.get('/',             protect, getNotifications);
router.patch('/:id/read',   protect, markNotificationRead);
router.post('/send',        protect, isAdmin, sendNotification);

// ─── New routes ───────────────────────────────────────────────────────────────
router.post('/expo-token',  protect, saveExpoPushToken);
router.post('/broadcast',   protect, isAdmin, broadcastNotification);

export default router;