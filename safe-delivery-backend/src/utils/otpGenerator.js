import OTP from '../models/otpModel.js';  

export const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export const saveOTP = async (identifier, otp, type) => {
  await OTP.deleteMany({ identifier, type });

  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  return await OTP.create({ identifier, otp, type, expiresAt });
};

export const verifyOTP = async (identifier, otp, type) => {
  const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS) || 3;

  const otpDoc = await OTP.findOne({ identifier, type });

  if (!otpDoc) {
    return { success: false, message: 'OTP not found or expired.' };
  }

  if (new Date() > otpDoc.expiresAt) {
    await OTP.deleteOne({ _id: otpDoc._id });
    return { success: false, message: 'OTP expired.' };
  }

  if (otpDoc.attempts >= maxAttempts) {
    await OTP.deleteOne({ _id: otpDoc._id });
    return { success: false, message: 'Too many attempts.' };
  }

  if (otpDoc.otp !== otp) {
    otpDoc.attempts += 1;
    await otpDoc.save();
    return { success: false, message: 'Invalid OTP' };
  }

  await OTP.deleteOne({ _id: otpDoc._id });
  return { success: true, message: 'OTP verified' };
};

export const checkCooldown = async (identifier, type) => {
  const cooldownSeconds = parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60;

  const otpDoc = await OTP.findOne({ identifier, type });
  if (!otpDoc) return { canResend: true, secondsLeft: 0 };

  const elapsed = (Date.now() - new Date(otpDoc.createdAt).getTime()) / 1000;

  if (elapsed < cooldownSeconds) {
    return {
      canResend: false,
      secondsLeft: Math.ceil(cooldownSeconds - elapsed),
    };
  }

  return { canResend: true, secondsLeft: 0 };
};