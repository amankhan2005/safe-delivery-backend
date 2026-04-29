const express = require('express');
const router = express.Router();
const { sendNotification } = require('../controllers/notificationController');
const { protect, isAdmin } = require('../middleware/auth');

router.post('/send', protect, isAdmin, sendNotification);

module.exports = router;