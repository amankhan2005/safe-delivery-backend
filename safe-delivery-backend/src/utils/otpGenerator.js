const OTP = require('../models/otpModel');

/**
 * Generate a random 4-digit OTP string.
 */
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

/**
 * Save OTP to DB — deletes any existing OTP for same identifier+type first.
 */
const saveOTP = async (identifier, otp, type) => {
  await OTP.deleteMany({ identifier, type });

  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  const otpDoc = await OTP.create({
    identifier,
    otp,
    type,
    expiresAt,
  });

  return otpDoc;
};

/**
 * Verify OTP — checks attempts, expiry, and match.
 * @returns {Object} { success: boolean, message: string }
 */
const verifyOTP = async (identifier, otp, type) => {
  const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS) || 3;

  const otpDoc = await OTP.findOne({ identifier, type });

  if (!otpDoc) {
    return { success: false, message: 'OTP not found or expired. Please request a new one.' };
  }

  if (new Date() > otpDoc.expiresAt) {
    await OTP.deleteOne({ _id: otpDoc._id });
    return { success: false, message: 'OTP has expired. Please request a new one.' };
  }

  if (otpDoc.attempts >= maxAttempts) {
    await OTP.deleteOne({ _id: otpDoc._id });
    return { success: false, message: 'Too many failed attempts. Please request a new OTP.' };
  }

  if (otpDoc.otp !== otp) {
    otpDoc.attempts += 1;
    await otpDoc.save();
    const remaining = maxAttempts - otpDoc.attempts;
    return {
      success: false,
      message: `Invalid OTP. ${remaining} attempt(s) remaining.`,
    };
  }

  // OTP is correct — mark verified and delete
  await OTP.deleteOne({ _id: otpDoc._id });
  return { success: true, message: 'OTP verified successfully.' };
};

/**
 * Check 60s cooldown for resend.
 * @returns {Object} { canResend: boolean, secondsLeft: number }
 */
const checkCooldown = async (identifier, type) => {
  const cooldownSeconds = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60;

  const otpDoc = await OTP.findOne({ identifier, type });
  if (!otpDoc) return { canResend: true, secondsLeft: 0 };

  const elapsed = (Date.now() - new Date(otpDoc.createdAt).getTime()) / 1000;

  if (elapsed < cooldownSeconds) {
    const secondsLeft = Math.ceil(cooldownSeconds - elapsed);
    return { canResend: false, secondsLeft };
  }

  return { canResend: true, secondsLeft: 0 };
};

module.exports = { generateOTP, saveOTP, verifyOTP, checkCooldown };