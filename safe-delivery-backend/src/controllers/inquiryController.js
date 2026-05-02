import Inquiry from '../models/inquiryModel.js';
import sendInquiryMail from '../utils/sendInquiryMail.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitInquiry(req, res) {
  try {
    const { firstName, lastName, phone, role, email, message } = req.body;

    const missing = [];

    if (!firstName?.trim()) missing.push('firstName');
    if (!phone?.trim()) missing.push('phone');
    if (!role?.trim()) missing.push('role');
    if (!email?.trim()) missing.push('email');
    if (!message?.trim()) missing.push('message');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`,
      });
    }

    // Email validation
    if (!EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email',
      });
    }

    // 🔥 Role fix
    const cleanRole = role.trim().toLowerCase();

    if (!['customer', 'rider'].includes(cleanRole)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be customer or rider',
      });
    }

    // Message validation
    if (message.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Message too short',
      });
    }

    // ✅ Save to DB
    const inquiry = await Inquiry.create({
      firstName: firstName.trim(),
      lastName: lastName?.trim() || '',
      phone: phone.trim(),
      role: cleanRole,
      email: email.trim().toLowerCase(),
      message: message.trim(),
    });

    // ✅ Send email safely (NO CRASH)
    try {
      await sendInquiryMail({
        firstName: inquiry.firstName,
        lastName: inquiry.lastName || '',
        email: inquiry.email,
        phone: inquiry.phone,
        role: inquiry.role,
        message: inquiry.message,
      });
    } catch (mailError) {
      console.error('⚠️ Mail failed:', mailError.message);
      // API ko crash nahi hone dena
    }

    return res.status(201).json({
      success: true,
      message: 'Inquiry submitted successfully',
      data: { inquiryId: inquiry._id },
    });

  } catch (error) {
    console.error('🔥 FULL ERROR:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}