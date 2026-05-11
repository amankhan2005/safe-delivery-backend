import OTP from '../models/otpModel.js';

// 4-digit OTP for email verification
export const generateOTP = () => {
  return String(Math.floor(1000 + Math.random() * 9000));
};

// 6-digit OTP for SMS/phone verification via Twilio
export const generatePhoneOTP = () => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

export const saveOTP = async (identifier, otp, type) => {
  await OTP.deleteMany({ identifier, type });

  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  return await OTP.create({ identifier, otp, type, expiresAt });
};

export const verifyOTP = async (identifier, otp, type) => {
  const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;

  const otpDoc = await OTP.findOne({ identifier, type });

  if (!otpDoc) return { success: false, message: 'OTP not found or expired.' };

  if (new Date() > otpDoc.expiresAt) {
    await OTP.deleteOne({ _id: otpDoc._id });
    return { success: false, message: 'OTP has expired. Please request a new one.' };
  }

  if (otpDoc.attempts >= maxAttempts) {
    await OTP.deleteOne({ _id: otpDoc._id });
    return { success: false, message: 'Too many failed attempts. Please request a new OTP.', blocked: true };
  }

  if (String(otpDoc.otp).trim() !== String(otp).trim()) {
    otpDoc.attempts += 1;
    await otpDoc.save();
    const remaining = maxAttempts - otpDoc.attempts;
    return {
      success: false,
      message: remaining > 0
        ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Too many failed attempts. Please request a new OTP.',
    };
  }

  await OTP.deleteOne({ _id: otpDoc._id });
  return { success: true, message: 'OTP verified.' };
};

export const checkCooldown = async (identifier, type) => {
  const cooldownSeconds = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60;

  const otpDoc = await OTP.findOne({ identifier, type });
  if (!otpDoc) return { canResend: true, secondsLeft: 0 };

  const elapsed = (Date.now() - new Date(otpDoc.createdAt).getTime()) / 1000;

  if (elapsed < cooldownSeconds) {
    return { canResend: false, secondsLeft: Math.ceil(cooldownSeconds - elapsed) };
  }

  return { canResend: true, secondsLeft: 0 };
};