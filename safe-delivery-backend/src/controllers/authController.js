const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Rider = require('../models/riderModel');
const { generateOTP, saveOTP, verifyOTP, checkCooldown } = require('../utils/otpGenerator');
const { normalizePhone } = require('../utils/phoneNormalizer');
const { isEmail, findUserByIdentifier, findRiderByIdentifier, generateAndSendOTP } = require('../utils/authHelpers');
const { sendOTPSms, resendOTPSms, sendResetOTPSms } = require('../services/smsService');
const { sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../services/emailService');
const { ok, err } = require('../utils/responseHelper');

const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const signResetToken = (id, role) =>
  jwt.sign({ id, role, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });

// ─── CUSTOMER AUTH ──────────────────────────────────────────────

exports.signup = async (req, res, next) => {
  try {
    // phone + email are already normalized by validateSignup middleware
    const { name, phone, email, password } = req.body;

    if (await User.findOne({ phone })) {
      return err(res, 'Phone number is already registered.', 400);
    }
    if (await User.findOne({ email })) {
      return err(res, 'Email address is already registered.', 400);
    }

    const user = await User.create({ name, phone, email, password });

    await generateAndSendOTP(phone, 'phone', { email, name });

    return ok(res, { userId: user._id }, 'Account created. Check your phone and email for verification codes.', 201);
  } catch (error) {
    next(error);
  }
};

exports.verifyPhoneOTP = async (req, res, next) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return err(res, 'userId and otp are required.', 400);

    const user = await User.findById(userId);
    if (!user) return err(res, 'User not found.', 404);

    const result = await verifyOTP(user.phone, otp, 'phone');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    user.isPhoneVerified = true;
    await user.save();

    if (user.isPhoneVerified && user.isEmailVerified) {
      const token = signToken(user._id, user.role);
      return ok(res, { token, user: { id: user._id, name: user.name, role: user.role } }, 'Phone verified. You are now logged in.');
    }

    return ok(res, {}, 'Phone verified. Please verify your email to continue.');
  } catch (error) {
    next(error);
  }
};

exports.verifyEmailOTP = async (req, res, next) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return err(res, 'userId and otp are required.', 400);

    const user = await User.findById(userId);
    if (!user) return err(res, 'User not found.', 404);

    const result = await verifyOTP(user.email, otp, 'email');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    user.isEmailVerified = true;
    await user.save();

    if (user.isPhoneVerified && user.isEmailVerified) {
      const token = signToken(user._id, user.role);
      return ok(res, { token, user: { id: user._id, name: user.name, role: user.role } }, 'Email verified. You are now logged in.');
    }

    return ok(res, {}, 'Email verified. Please verify your phone to continue.');
  } catch (error) {
    next(error);
  }
};

exports.resendOTP = async (req, res, next) => {
  try {
    let { identifier, type, userId } = req.body;
    if (!identifier || !type) return err(res, 'identifier and type are required.', 400);
    if (!['phone', 'email'].includes(type)) return err(res, 'type must be phone or email.', 400);

    const normalizedIdentifier = type === 'phone'
      ? normalizePhone(identifier)
      : identifier.trim().toLowerCase();

    const cooldown = await checkCooldown(normalizedIdentifier, type);
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(normalizedIdentifier, otp, type);

    if (type === 'phone') {
      await resendOTPSms(normalizedIdentifier, otp);
    } else {
      let name = 'User';
      if (userId) {
        const user = await User.findById(userId);
        if (user) name = user.name;
      }
      await sendOTPEmail(normalizedIdentifier, name, otp, 'email');
    }

    return ok(res, {}, 'OTP resent successfully.');
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    // identifier already normalized by validateLogin middleware
    const { identifier, password } = req.body;

    const user = await findUserByIdentifier(identifier, true);
    if (!user || !(await user.matchPassword(password))) {
      return err(res, 'Invalid credentials.', 401);
    }

    if (!user.isPhoneVerified) return err(res, 'Please verify your phone number first.', 403);
    if (!user.isEmailVerified) return err(res, 'Please verify your email address first.', 403);

    if (user.isFirstLogin) {
      await sendWelcomeEmail(user.email, user.name).catch(console.error);
      user.isFirstLogin = false;
      await user.save();
    }

    const token = signToken(user._id, user.role);
    return ok(res, {
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    }, 'Login successful.');
  } catch (error) {
    next(error);
  }
};

exports.sendLoginOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const user = await User.findOne({ phone });
    if (!user) return err(res, 'No account found with this phone number.', 404);

    if (!user.isPhoneVerified) {
      return err(res, 'Please verify your phone number first before using OTP login.', 403);
    }

    const cooldown = await checkCooldown(phone, 'login');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'login');
    await sendOTPSms(phone, otp);

    return ok(res, {}, 'Login OTP sent to your phone.');
  } catch (error) {
    next(error);
  }
};

exports.verifyLoginOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { otp } = req.body;
    if (!phone || !otp) return err(res, 'phone and otp are required.', 400);

    const user = await User.findOne({ phone });
    if (!user) return err(res, 'No account found with this phone number.', 404);

    const result = await verifyOTP(phone, otp, 'login');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    if (user.isFirstLogin) {
      await sendWelcomeEmail(user.email, user.name).catch(console.error);
      user.isFirstLogin = false;
      await user.save();
    }

    const token = signToken(user._id, user.role);
    return ok(res, {
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    }, 'Login successful.');
  } catch (error) {
    next(error);
  }
};

exports.resendLoginOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const user = await User.findOne({ phone });
    if (!user) return err(res, 'No account found with this phone number.', 404);

    const cooldown = await checkCooldown(phone, 'login');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'login');
    await resendOTPSms(phone, otp);

    return ok(res, {}, 'Login OTP resent.');
  } catch (error) {
    next(error);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const user = await User.findOne({ phone });
    if (!user) return err(res, 'No account found with this phone number.', 404);

    const cooldown = await checkCooldown(phone, 'reset');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'reset');
    await sendResetOTPSms(phone, otp);
    await sendPasswordResetEmail(user.email, user.name, otp).catch(console.error);

    return ok(res, {}, 'Password reset OTP sent to your phone and email.');
  } catch (error) {
    next(error);
  }
};

exports.resendForgotOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const user = await User.findOne({ phone });
    if (!user) return err(res, 'No account found with this phone number.', 404);

    const cooldown = await checkCooldown(phone, 'reset');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'reset');
    await sendResetOTPSms(phone, otp);

    return ok(res, {}, 'Reset OTP resent.');
  } catch (error) {
    next(error);
  }
};

exports.verifyResetOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { otp } = req.body;
    if (!phone || !otp) return err(res, 'phone and otp are required.', 400);

    const user = await User.findOne({ phone });
    if (!user) return err(res, 'No account found.', 404);

    const result = await verifyOTP(phone, otp, 'reset');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    // OTP deleted on success — reuse impossible
    const resetToken = signResetToken(user._id, user.role);
    return ok(res, { resetToken }, 'OTP verified. Use resetToken to set a new password.');
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    // Validated by validateResetPassword middleware
    const { resetToken, newPassword } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return err(res, 'Invalid or expired reset token.', 400);
    }

    if (decoded.purpose !== 'reset') return err(res, 'Invalid reset token.', 400);
    if (decoded.role === 'rider') return err(res, 'Invalid reset token for this account type.', 400);

    const user = await User.findById(decoded.id);
    if (!user) return err(res, 'User not found.', 404);

    user.password = newPassword;
    await user.save();

    return ok(res, {}, 'Password reset successfully. You can now log in.');
  } catch (error) {
    next(error);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return err(res, 'oldPassword and newPassword are required.', 400);
    if (newPassword.length < 6) return err(res, 'New password must be at least 6 characters.', 400);

    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.matchPassword(oldPassword))) {
      return err(res, 'Old password is incorrect.', 401);
    }

    user.password = newPassword;
    await user.save();

    return ok(res, {}, 'Password changed successfully.');
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    return ok(res, { user: req.user }, 'User details fetched.');
  } catch (error) {
    next(error);
  }
};

exports.saveFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return err(res, 'fcmToken is required.', 400);

    req.user.fcmToken = fcmToken;
    await req.user.save();

    return ok(res, {}, 'FCM token saved.');
  } catch (error) {
    next(error);
  }
};

// ─── RIDER AUTH ──────────────────────────────────────────────────

exports.riderSignup = async (req, res, next) => {
  try {
    // phone + email normalized by validateSignup middleware
    const { name, phone, email, password } = req.body;

    // Check selfie first — avoids leaking whether phone/email is registered
    if (!req.file) {
      return err(res, 'A live selfie photo is required to create a rider account.', 400);
    }

    if (await Rider.findOne({ phone })) {
      return err(res, 'Phone number is already registered.', 400);
    }
    if (await Rider.findOne({ email })) {
      return err(res, 'Email address is already registered.', 400);
    }

    const rider = await Rider.create({
      name,
      phone,
      email,
      password,
      selfie: {
        url: req.file.path,
        publicId: req.file.filename,
        capturedAt: new Date(),
      },
    });

    const otp = generateOTP();
    await saveOTP(phone, otp, 'phone');
    await sendOTPSms(phone, otp);

    return ok(res, { riderId: rider._id }, 'Rider account created. Check your phone for verification code.', 201);
  } catch (error) {
    next(error);
  }
};

exports.riderVerifyPhoneOTP = async (req, res, next) => {
  try {
    const { riderId, otp } = req.body;
    if (!riderId || !otp) return err(res, 'riderId and otp are required.', 400);

    const rider = await Rider.findById(riderId);
    if (!rider) return err(res, 'Rider not found.', 404);

    const result = await verifyOTP(rider.phone, otp, 'phone');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    rider.isPhoneVerified = true;
    await rider.save();

    const token = signToken(rider._id, 'rider');
    return ok(res, { token, rider: { id: rider._id, name: rider.name, role: 'rider' } }, 'Phone verified. Please complete KYC.');
  } catch (error) {
    next(error);
  }
};

exports.riderResendOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const rider = await Rider.findOne({ phone });
    if (!rider) return err(res, 'No rider account found with this phone number.', 404);

    const cooldown = await checkCooldown(phone, 'phone');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'phone');
    await resendOTPSms(phone, otp);

    return ok(res, {}, 'OTP resent.');
  } catch (error) {
    next(error);
  }
};

exports.riderLogin = async (req, res, next) => {
  try {
    // identifier already normalized by validateLogin middleware
    const { identifier, password } = req.body;

    const rider = await findRiderByIdentifier(identifier, true);
    if (!rider || !(await rider.matchPassword(password))) {
      return err(res, 'Invalid credentials.', 401);
    }

    if (!rider.isPhoneVerified) return err(res, 'Please verify your phone number first.', 403);
    if (rider.status === 'banned') return err(res, 'Your account has been banned. Contact support.', 403);
    if (rider.status === 'rejected') return err(res, 'Your application was rejected. Contact support.', 403);

    const token = signToken(rider._id, 'rider');
    return ok(res, {
      token,
      rider: { id: rider._id, name: rider.name, status: rider.status, kycCompleted: rider.kycCompleted },
    }, 'Login successful.');
  } catch (error) {
    next(error);
  }
};

exports.riderSendLoginOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const rider = await Rider.findOne({ phone });
    if (!rider) return err(res, 'No rider account found with this phone number.', 404);

    const cooldown = await checkCooldown(phone, 'login');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'login');
    await sendOTPSms(phone, otp);

    return ok(res, {}, 'Login OTP sent.');
  } catch (error) {
    next(error);
  }
};

exports.riderVerifyLoginOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { otp } = req.body;
    if (!phone || !otp) return err(res, 'phone and otp are required.', 400);

    const rider = await Rider.findOne({ phone });
    if (!rider) return err(res, 'Rider not found.', 404);

    const result = await verifyOTP(phone, otp, 'login');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    if (rider.status === 'banned') return err(res, 'Your account has been banned.', 403);

    const token = signToken(rider._id, 'rider');
    return ok(res, {
      token,
      rider: { id: rider._id, name: rider.name, status: rider.status },
    }, 'Login successful.');
  } catch (error) {
    next(error);
  }
};

exports.riderResendLoginOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const rider = await Rider.findOne({ phone });
    if (!rider) return err(res, 'No rider account found with this phone number.', 404);

    const cooldown = await checkCooldown(phone, 'login');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'login');
    await resendOTPSms(phone, otp);

    return ok(res, {}, 'Login OTP resent.');
  } catch (error) {
    next(error);
  }
};

exports.riderForgotPassword = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const rider = await Rider.findOne({ phone });
    if (!rider) return err(res, 'No rider account found.', 404);

    const cooldown = await checkCooldown(phone, 'reset');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'reset');
    await sendResetOTPSms(phone, otp);

    return ok(res, {}, 'Reset OTP sent to your phone.');
  } catch (error) {
    next(error);
  }
};

exports.riderResendForgotOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return err(res, 'Phone number is required.', 400);

    const rider = await Rider.findOne({ phone });
    if (!rider) return err(res, 'No rider account found with this phone number.', 404);

    const cooldown = await checkCooldown(phone, 'reset');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const otp = generateOTP();
    await saveOTP(phone, otp, 'reset');
    await sendResetOTPSms(phone, otp);

    return ok(res, {}, 'Reset OTP resent.');
  } catch (error) {
    next(error);
  }
};

exports.riderVerifyResetOTP = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { otp } = req.body;
    if (!phone || !otp) return err(res, 'phone and otp are required.', 400);

    const rider = await Rider.findOne({ phone });
    if (!rider) return err(res, 'Rider not found.', 404);

    const result = await verifyOTP(phone, otp, 'reset');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    // OTP deleted on success — reuse impossible
    const resetToken = signResetToken(rider._id, 'rider');
    return ok(res, { resetToken }, 'OTP verified. Use resetToken to set a new password.');
  } catch (error) {
    next(error);
  }
};

exports.riderResetPassword = async (req, res, next) => {
  try {
    // Validated by validateResetPassword middleware
    const { resetToken, newPassword } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return err(res, 'Invalid or expired reset token.', 400);
    }

    if (decoded.purpose !== 'reset') return err(res, 'Invalid reset token.', 400);
    if (decoded.role !== 'rider') return err(res, 'Invalid token for rider.', 400);

    const rider = await Rider.findById(decoded.id);
    if (!rider) return err(res, 'Rider not found.', 404);

    rider.password = newPassword;
    await rider.save();

    return ok(res, {}, 'Password reset successfully.');
  } catch (error) {
    next(error);
  }
};