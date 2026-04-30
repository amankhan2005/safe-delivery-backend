import Inquiry from '../models/inquiryModel.js';
import sendInquiryMail from '../utils/sendInquiryMail.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitInquiry(req, res) {
  try {
    const { firstName, lastName, phone, role, email, message } = req.body;

    // ── Validate required fields ──────────────────────────────
    const missing = [];
    if (!firstName || !firstName.trim()) missing.push('firstName');
    if (!lastName  || !lastName.trim())  missing.push('lastName');
    if (!phone     || !phone.trim())     missing.push('phone');
    if (!role      || !role.trim())      missing.push('role');
    if (!email     || !email.trim())     missing.push('email');
    if (!message   || !message.trim())   missing.push('message');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}.`,
      });
    }

    // ── Validate email format ─────────────────────────────────
    if (!EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.',
      });
    }

    // ── Validate role ─────────────────────────────────────────
    if (!['customer', 'driver'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be either "customer" or "driver".',
      });
    }

    // ── Validate message length ───────────────────────────────
    if (message.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Message must be at least 10 characters long.',
      });
    }

    // ── Save inquiry to DB ────────────────────────────────────
    const inquiry = await Inquiry.create({
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      phone:     phone.trim(),
      role,
      email:     email.trim().toLowerCase(),
      message:   message.trim(),
    });

    // ── Send email to support team ────────────────────────────
    await sendInquiryMail({
      firstName: inquiry.firstName,
      lastName:  inquiry.lastName,
      email:     inquiry.email,
      phone:     inquiry.phone,
      role:      inquiry.role,
      message:   inquiry.message,
    });

    return res.status(201).json({
      success: true,
      message: 'Inquiry submitted successfully. Our support team will get back to you within 24 hours.',
      data: { inquiryId: inquiry._id },
    });

  } catch (error) {
    console.error('Inquiry error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again later.',
    });
  }
}