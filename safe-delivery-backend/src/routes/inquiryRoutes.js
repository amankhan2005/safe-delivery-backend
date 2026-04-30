const express = require('express');
const router = express.Router();
const { submitInquiry } = require('../controllers/inquiryController');

// POST /api/inquiry
router.post('/', submitInquiry);

module.exports = router;