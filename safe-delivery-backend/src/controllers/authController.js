import pkg from 'jsonwebtoken';
const { sign, verify } = pkg;

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

import User  from '../models/userModel.js';
import Rider from '../models/riderModel.js';
import { generateOTP, saveOTP, verifyOTP, checkCooldown } from '../utils/otpGenerator.js';
import { normalizePhone, isValidLiberiaPhone } from '../utils/phoneNormalizer.js';
import { findUserByIdentifier, findRiderByIdentifier } from '../utils/authHelpers.js';
import { sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail } from '../services/emailService.js';
import { ok, err } from '../utils/responseHelper.js';
import { saveTempSignup, getTempSignup, deleteTempSignup } from '../utils/tempStore.js';
import { initializeFirebase } from '../config/firebase.js';

// Ensure firebase is ready
initializeFirebase();

const signToken = (id, role) =>
  sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const signResetToken = (id, role) =>
  sign({ id, role, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });

// ── Verify Firebase ID Token ──────────────────────────────────────────────────
async function verifyFirebaseToken(idToken) {
  try {
    if (admin.apps.length === 0) {
      console.error('[Firebase] No app initialized');
      return { success: false, error: 'Firebase not initialized' };
    }
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('[Firebase] Token verified. Phone:', decoded.phone_number, 'UID:', decoded.uid);
    return { success: true, phone: decoded.phone_number, uid: decoded.uid };
  } catch (e) {
    console.error('[Firebase] Token verify error:', e.code, e.message);
    return { success: false, error: e.message };
  }
}

// ─── CUSTOMER AUTH ────────────────────────────────────────────────────────────

export async function signup(req, res, next) {
  try {
    let { name, phone, email, password } = req.body;

    if (!name || !phone || !email || !password) {
      return err(res, 'All fields are required.', 400);
    }

    phone = normalizePhone(phone);
    if (!isValidLiberiaPhone(phone)) {
      return err(res, 'Invalid phone number. Only Liberia (+231) numbers are allowed.', 400);
    }

    email = email.trim().toLowerCase();

    // Duplicate checks BEFORE saving anything
    if (await User.findOne({ phone })) return err(res, 'Phone number is already registered.', 400);
    if (await User.findOne({ email })) return err(res, 'Email address is already registered.', 400);

    // Store temp — NO DB write
    saveTempSignup(phone, email, { name, phone, email, password }, 'user');
    console.log('[Signup] Temp stored for phone:', phone, 'email:', email);

    // Send email OTP
    const otp = generateOTP();
    await saveOTP(email, otp, 'signup_email');

    try {
      await sendOTPEmail(email, name, otp, 'email');
      console.log('[Signup] Email OTP sent to:', email, '| OTP:', otp);
    } catch (emailErr) {
      console.error('[Signup] Email send failed:', emailErr.message);
      // Don't fail signup — user can use phone OTP
    }

    return ok(res, {
      message: 'Signup initiated.',
      emailSent: true,
      hint: 'Verify phone via Firebase SMS or use Email OTP to complete signup.',
    }, 'Signup initiated. Verify to create your account.', 201);

  } catch (error) {
    next(error);
  }
}

export async function verifyPhoneOTP(req, res, next) {
  try {
    const { phone: rawPhone, firebaseIdToken } = req.body;

    if (!rawPhone || !firebaseIdToken) {
      return err(res, 'phone and firebaseIdToken are required.', 400);
    }

    const phone = normalizePhone(rawPhone);
    console.log('[VerifyPhone] Attempting for phone:', phone);

    const fbResult = await verifyFirebaseToken(firebaseIdToken);
    if (!fbResult.success) {
      return err(res, `Firebase token invalid: ${fbResult.error || 'expired'}`, 401);
    }

    const fbPhone = normalizePhone(fbResult.phone || '');
    console.log('[VerifyPhone] Firebase phone:', fbPhone, '| Requested phone:', phone);

    if (fbPhone !== phone) {
      return err(res, 'Phone number does not match Firebase token.', 400);
    }

    // Get temp data
    const temp = getTempSignup(phone);
    if (!temp) {
      return err(res, 'Signup session expired. Please start over.', 400);
    }

    const { name, email, password } = temp.data;

    // Final duplicate checks
    if (await User.findOne({ phone })) {
      deleteTempSignup(phone, email);
      return err(res, 'Phone already registered.', 400);
    }
    if (await User.findOne({ email })) {
      deleteTempSignup(phone, email);
      return err(res, 'Email already registered.', 400);
    }

    // CREATE USER only after verification
    const user = await User.create({
      name, phone, email, password,
      isPhoneVerified: true,
      isEmailVerified: false,
    });
    deleteTempSignup(phone, email);
    console.log('[VerifyPhone] User created:', user._id, 'phone:', phone);

    // Send welcome email async
    sendWelcomeEmail(user.email, user.name).catch(e => console.error('[Welcome email]', e.message));

    const token = signToken(user._id, user.role);
    return ok(res, {
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    }, 'Phone verified. Account created successfully.');

  } catch (error) {
    next(error);
  }
}

export async function verifyEmailOTP(req, res, next) {
  try {
    const { phone: rawPhone, email: rawEmail, otp } = req.body;

    if (!rawEmail || !otp) return err(res, 'email and otp are required.', 400);

    const email = rawEmail.trim().toLowerCase();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    console.log('[VerifyEmail] Attempting for email:', email, 'otp:', otp);

    const result = await verifyOTP(email, otp, 'signup_email');
    if (!result.success) {
      console.log('[VerifyEmail] OTP failed:', result.message);
      return err(res, result.message, result.blocked ? 429 : 400);
    }

    // Get temp data by email or phone
    const temp = getTempSignup(email) || (phone ? getTempSignup(phone) : null);
    if (!temp) {
      return err(res, 'Signup session expired. Please start over.', 400);
    }

    const { name, phone: storedPhone, password } = temp.data;
    const finalPhone = storedPhone || phone;

    // Final duplicate checks
    if (await User.findOne({ phone: finalPhone })) {
      deleteTempSignup(finalPhone, email);
      return err(res, 'Phone already registered.', 400);
    }
    if (await User.findOne({ email })) {
      deleteTempSignup(finalPhone, email);
      return err(res, 'Email already registered.', 400);
    }

    // CREATE USER only after verification
    const user = await User.create({
      name, phone: finalPhone, email, password,
      isPhoneVerified: false,
      isEmailVerified: true,
    });
    deleteTempSignup(finalPhone, email);
    console.log('[VerifyEmail] User created:', user._id, 'email:', email);

    // Welcome email async
    sendWelcomeEmail(user.email, user.name).catch(e => console.error('[Welcome email]', e.message));

    const token = signToken(user._id, user.role);
    return ok(res, {
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    }, 'Email verified. Account created successfully.');

  } catch (error) {
    next(error);
  }
}

export async function resendOTP(req, res, next) {
  try {
    const { email: rawEmail, name: rawName } = req.body;
    if (!rawEmail) return err(res, 'email is required.', 400);

    const email = rawEmail.trim().toLowerCase();

    const cooldown = await checkCooldown(email, 'signup_email');
    if (!cooldown.canResend) {
      return err(res, `Please wait ${cooldown.secondsLeft} seconds before resending.`, 429);
    }

    const temp = getTempSignup(email);
    const name = temp?.data?.name || rawName || 'User';

    const otp = generateOTP();
    await saveOTP(email, otp, 'signup_email');

    try {
      await sendOTPEmail(email, name, otp, 'email');
      console.log('[ResendOTP] Email OTP resent to:', email, '| OTP:', otp);
    } catch (emailErr) {
      console.error('[ResendOTP] Email failed:', emailErr.message);
      return err(res, 'Failed to send email. Please try again.', 500);
    }

    return ok(res, {}, 'Email OTP resent successfully.');
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { identifier, password } = req.body;

    const user = await findUserByIdentifier(identifier, true);
    if (!user || !(await user.matchPassword(password))) {
      return err(res, 'Invalid credentials.', 401);
    }

    if (!user.isPhoneVerified && !user.isEmailVerified) {
      return err(res, 'Please verify your phone or email first.', 403);
    }

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
}

export async function forgotPassword(req, res, next) {
  try {
    const { email: rawEmail } = req.body;
    if (!rawEmail) return err(res, 'Email is required.', 400);

    const email = rawEmail.trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return err(res, 'No account found with this email.', 404);

    const cooldown = await checkCooldown(email, 'reset');
    if (!cooldown.canResend) return err(res, `Please wait ${cooldown.secondsLeft} seconds.`, 429);

    const otp = generateOTP();
    await saveOTP(email, otp, 'reset');

    try {
      await sendPasswordResetEmail(user.email, user.name, otp);
      console.log('[ForgotPassword] Reset OTP sent to:', email, '| OTP:', otp);
    } catch (e) {
      console.error('[ForgotPassword] Email failed:', e.message);
      return err(res, 'Failed to send reset email.', 500);
    }

    return ok(res, {}, 'Password reset OTP sent to your email.');
  } catch (error) {
    next(error);
  }
}

export async function resendForgotOTP(req, res, next) {
  try {
    const { email: rawEmail } = req.body;
    if (!rawEmail) return err(res, 'Email is required.', 400);

    const email = rawEmail.trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return err(res, 'No account found with this email.', 404);

    const cooldown = await checkCooldown(email, 'reset');
    if (!cooldown.canResend) return err(res, `Please wait ${cooldown.secondsLeft} seconds.`, 429);

    const otp = generateOTP();
    await saveOTP(email, otp, 'reset');
    await sendPasswordResetEmail(user.email, user.name, otp).catch(console.error);

    return ok(res, {}, 'Reset OTP resent.');
  } catch (error) {
    next(error);
  }
}

export async function verifyResetOTP(req, res, next) {
  try {
    const { email: rawEmail, otp } = req.body;
    if (!rawEmail || !otp) return err(res, 'email and otp are required.', 400);

    const email = rawEmail.trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return err(res, 'No account found.', 404);

    const result = await verifyOTP(email, otp, 'reset');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    const resetToken = signResetToken(user._id, user.role);
    return ok(res, { resetToken }, 'OTP verified.');
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { resetToken, newPassword } = req.body;

    let decoded;
    try { decoded = verify(resetToken, process.env.JWT_SECRET); }
    catch { return err(res, 'Invalid or expired reset token.', 400); }

    if (decoded.purpose !== 'reset') return err(res, 'Invalid reset token.', 400);
    if (decoded.role === 'rider') return err(res, 'Invalid token for this account type.', 400);

    const user = await User.findById(decoded.id);
    if (!user) return err(res, 'User not found.', 404);

    user.password = newPassword;
    await user.save();

    return ok(res, {}, 'Password reset successfully.');
  } catch (error) {
    next(error);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return err(res, 'Both passwords are required.', 400);
    if (newPassword.length < 6) return err(res, 'New password must be at least 6 characters.', 400);

    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.matchPassword(oldPassword))) return err(res, 'Old password is incorrect.', 401);

    user.password = newPassword;
    await user.save();
    return ok(res, {}, 'Password changed successfully.');
  } catch (error) {
    next(error);
  }
}

export async function getMe(req, res, next) {
  try {
    return ok(res, { user: req.user }, 'User details fetched.');
  } catch (error) {
    next(error);
  }
}

export async function saveFcmToken(req, res, next) {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return err(res, 'fcmToken is required.', 400);
    req.user.fcmToken = fcmToken;
    await req.user.save();
    return ok(res, {}, 'FCM token saved.');
  } catch (error) {
    next(error);
  }
}

// ─── RIDER AUTH ───────────────────────────────────────────────────────────────

export async function riderSignup(req, res, next) {
  try {
    let { name, phone: rawPhone, email: rawEmail, password } = req.body;

    if (!req.file) return err(res, 'A live selfie photo is required.', 400);

    const phone = normalizePhone(rawPhone);
    if (!isValidLiberiaPhone(phone)) {
      return err(res, 'Invalid phone number. Only Liberia (+231) allowed.', 400);
    }

    const email = rawEmail.trim().toLowerCase();

    if (await Rider.findOne({ phone })) return err(res, 'Phone number is already registered.', 400);
    if (await Rider.findOne({ email })) return err(res, 'Email address is already registered.', 400);

    // Store temp — NO DB write
    saveTempSignup(phone, email, {
      name, phone, email, password,
      selfie: {
        url: req.file.path,
        publicId: req.file.filename,
        capturedAt: new Date(),
      },
    }, 'rider');
    console.log('[RiderSignup] Temp stored for phone:', phone, 'email:', email);

    // Send email OTP
    const otp = generateOTP();
    await saveOTP(email, otp, 'signup_email');

    try {
      await sendOTPEmail(email, name, otp, 'email');
      console.log('[RiderSignup] Email OTP sent to:', email, '| OTP:', otp);
    } catch (emailErr) {
      console.error('[RiderSignup] Email send failed:', emailErr.message);
    }

    return ok(res, {
      message: 'Rider signup initiated.',
      emailSent: true,
      hint: 'Verify phone via Firebase SMS or use Email OTP to complete signup.',
    }, 'Rider signup initiated. Verify to create your account.', 201);

  } catch (error) {
    next(error);
  }
}

export async function riderVerifyPhoneOTP(req, res, next) {
  try {
    const { phone: rawPhone, firebaseIdToken } = req.body;

    if (!rawPhone || !firebaseIdToken) {
      return err(res, 'phone and firebaseIdToken are required.', 400);
    }

    const phone = normalizePhone(rawPhone);
    console.log('[RiderVerifyPhone] Attempting for phone:', phone);

    const fbResult = await verifyFirebaseToken(firebaseIdToken);
    if (!fbResult.success) {
      return err(res, `Firebase token invalid: ${fbResult.error || 'expired'}`, 401);
    }

    const fbPhone = normalizePhone(fbResult.phone || '');
    if (fbPhone !== phone) {
      return err(res, 'Phone number does not match Firebase token.', 400);
    }

    const temp = getTempSignup(phone);
    if (!temp) return err(res, 'Rider signup session expired. Please start over.', 400);

    const { name, email, password, selfie } = temp.data;

    if (await Rider.findOne({ phone })) { deleteTempSignup(phone, email); return err(res, 'Phone already registered.', 400); }
    if (await Rider.findOne({ email })) { deleteTempSignup(phone, email); return err(res, 'Email already registered.', 400); }

    const rider = await Rider.create({
      name, phone, email, password, selfie,
      isPhoneVerified: true,
      isEmailVerified: false,
    });
    deleteTempSignup(phone, email);
    console.log('[RiderVerifyPhone] Rider created:', rider._id);

    const token = signToken(rider._id, 'rider');
    return ok(res, {
      token,
      rider: { id: rider._id, name: rider.name, role: 'rider', status: rider.status },
    }, 'Phone verified. Rider account created. Please complete KYC.');

  } catch (error) {
    next(error);
  }
}

export async function riderVerifyEmailOTP(req, res, next) {
  try {
    const { phone: rawPhone, email: rawEmail, otp } = req.body;

    if (!rawEmail || !otp) return err(res, 'email and otp are required.', 400);

    const email = rawEmail.trim().toLowerCase();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    console.log('[RiderVerifyEmail] Attempting for email:', email);

    const result = await verifyOTP(email, otp, 'signup_email');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    const temp = getTempSignup(email) || (phone ? getTempSignup(phone) : null);
    if (!temp) return err(res, 'Rider signup session expired. Please start over.', 400);

    const { name, phone: storedPhone, password, selfie } = temp.data;
    const finalPhone = storedPhone || phone;

    if (await Rider.findOne({ phone: finalPhone })) { deleteTempSignup(finalPhone, email); return err(res, 'Phone already registered.', 400); }
    if (await Rider.findOne({ email })) { deleteTempSignup(finalPhone, email); return err(res, 'Email already registered.', 400); }

    const rider = await Rider.create({
      name, phone: finalPhone, email, password, selfie,
      isPhoneVerified: false,
      isEmailVerified: true,
    });
    deleteTempSignup(finalPhone, email);
    console.log('[RiderVerifyEmail] Rider created:', rider._id);

    const token = signToken(rider._id, 'rider');
    return ok(res, {
      token,
      rider: { id: rider._id, name: rider.name, role: 'rider', status: rider.status },
    }, 'Email verified. Rider account created. Please complete KYC.');

  } catch (error) {
    next(error);
  }
}

export async function riderResendEmailOTP(req, res, next) {
  try {
    const { email: rawEmail, name: rawName } = req.body;
    if (!rawEmail) return err(res, 'email is required.', 400);

    const email = rawEmail.trim().toLowerCase();

    const cooldown = await checkCooldown(email, 'signup_email');
    if (!cooldown.canResend) return err(res, `Please wait ${cooldown.secondsLeft} seconds.`, 429);

    const temp = getTempSignup(email);
    const name = temp?.data?.name || rawName || 'Rider';

    const otp = generateOTP();
    await saveOTP(email, otp, 'signup_email');

    try {
      await sendOTPEmail(email, name, otp, 'email');
      console.log('[RiderResendOTP] Email OTP resent to:', email, '| OTP:', otp);
    } catch (e) {
      console.error('[RiderResendOTP] Email failed:', e.message);
      return err(res, 'Failed to send email.', 500);
    }

    return ok(res, {}, 'Email OTP resent successfully.');
  } catch (error) {
    next(error);
  }
}

export async function riderLogin(req, res, next) {
  try {
    const { identifier, password } = req.body;

    const rider = await findRiderByIdentifier(identifier, true);
    if (!rider || !(await rider.matchPassword(password))) return err(res, 'Invalid credentials.', 401);

    if (!rider.isPhoneVerified && !rider.isEmailVerified) {
      return err(res, 'Please verify your phone or email first.', 403);
    }

    if (rider.status === 'banned') return err(res, 'Your account has been banned.', 403);
    if (rider.status === 'rejected') return err(res, 'Your application was rejected.', 403);

    const token = signToken(rider._id, 'rider');
    return ok(res, {
      token,
      rider: { id: rider._id, name: rider.name, status: rider.status, kycCompleted: rider.kycCompleted },
    }, 'Login successful.');
  } catch (error) {
    next(error);
  }
}

export async function riderForgotPassword(req, res, next) {
  try {
    const { email: rawEmail } = req.body;
    if (!rawEmail) return err(res, 'Email is required.', 400);

    const email = rawEmail.trim().toLowerCase();
    const rider = await Rider.findOne({ email });
    if (!rider) return err(res, 'No rider account found with this email.', 404);

    const cooldown = await checkCooldown(email, 'reset');
    if (!cooldown.canResend) return err(res, `Please wait ${cooldown.secondsLeft} seconds.`, 429);

    const otp = generateOTP();
    await saveOTP(email, otp, 'reset');

    try {
      await sendPasswordResetEmail(rider.email, rider.name, otp);
      console.log('[RiderForgotPassword] Reset OTP sent to:', email);
    } catch (e) {
      console.error('[RiderForgotPassword] Email failed:', e.message);
      return err(res, 'Failed to send reset email.', 500);
    }

    return ok(res, {}, 'Reset OTP sent to your email.');
  } catch (error) {
    next(error);
  }
}

export async function riderResendForgotOTP(req, res, next) {
  try {
    const { email: rawEmail } = req.body;
    if (!rawEmail) return err(res, 'Email is required.', 400);

    const email = rawEmail.trim().toLowerCase();
    const rider = await Rider.findOne({ email });
    if (!rider) return err(res, 'No rider account found.', 404);

    const cooldown = await checkCooldown(email, 'reset');
    if (!cooldown.canResend) return err(res, `Please wait ${cooldown.secondsLeft} seconds.`, 429);

    const otp = generateOTP();
    await saveOTP(email, otp, 'reset');
    await sendPasswordResetEmail(rider.email, rider.name, otp).catch(console.error);

    return ok(res, {}, 'Reset OTP resent.');
  } catch (error) {
    next(error);
  }
}

export async function riderVerifyResetOTP(req, res, next) {
  try {
    const { email: rawEmail, otp } = req.body;
    if (!rawEmail || !otp) return err(res, 'email and otp are required.', 400);

    const email = rawEmail.trim().toLowerCase();
    const rider = await Rider.findOne({ email });
    if (!rider) return err(res, 'Rider not found.', 404);

    const result = await verifyOTP(email, otp, 'reset');
    if (!result.success) return err(res, result.message, result.blocked ? 429 : 400);

    const resetToken = signResetToken(rider._id, 'rider');
    return ok(res, { resetToken }, 'OTP verified.');
  } catch (error) {
    next(error);
  }
}

export async function riderResetPassword(req, res, next) {
  try {
    const { resetToken, newPassword } = req.body;

    let decoded;
    try { decoded = verify(resetToken, process.env.JWT_SECRET); }
    catch { return err(res, 'Invalid or expired reset token.', 400); }

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
}

export async function riderChangePassword(req, res, next) {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return err(res, 'Both passwords are required.', 400);
    if (newPassword.length < 6) return err(res, 'New password must be at least 6 characters.', 400);

    const rider = await Rider.findById(req.user._id).select('+password');
    if (!rider) return err(res, 'Rider not found.', 404);
    if (!(await rider.matchPassword(oldPassword))) return err(res, 'Old password is incorrect.', 401);

    rider.password = newPassword;
    await rider.save();

    return ok(res, {}, 'Password changed successfully.');
  } catch (error) {
    next(error);
  }
}
// ─── DELETE ACCOUNT — Customer ────────────────────────────────────────────────
export async function deleteUserAccount(req, res, next) {
  try {
    const { password } = req.body;
    if (!password) return err(res, 'Password is required to delete account.', 400);

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return err(res, 'Account not found.', 404);

    if (user.isDeleted) return err(res, 'Account already deleted.', 400);

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return err(res, 'Incorrect password. Account not deleted.', 401);

    // Anonymize — allow re-signup with same credentials after deletion
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        name:            'Deleted User',
        email:           `deleted_${req.user._id}@deleted.invalid`,
        phone:           `deleted_${req.user._id}`,
        isDeleted:       true,
        deletedAt:       new Date(),
        fcmToken:        null,
        isPhoneVerified: false,
        isEmailVerified: false,
        password:        'DELETED',
      }
    });

    console.log(`[DeleteAccount] Customer ${req.user._id} deleted their account.`);
    return ok(res, {}, 'Account deleted successfully. All your data has been removed.');
  } catch (error) {
    next(error);
  }
}

// ─── DELETE ACCOUNT — Rider ───────────────────────────────────────────────────
export async function deleteRiderAccount(req, res, next) {
  try {
    const { password } = req.body;
    if (!password) return err(res, 'Password is required to delete account.', 400);

    const rider = await Rider.findById(req.user._id).select('+password');
    if (!rider) return err(res, 'Account not found.', 404);

    if (rider.isDeleted) return err(res, 'Account already deleted.', 400);

    const isMatch = await rider.matchPassword(password);
    if (!isMatch) return err(res, 'Incorrect password. Account not deleted.', 401);

    await Rider.findByIdAndUpdate(req.user._id, {
      $set: {
        name:      'Deleted Rider',
        email:     `deleted_rider_${req.user._id}@deleted.invalid`,
        phone:     `deleted_rider_${req.user._id}`,
        isDeleted: true,
        deletedAt: new Date(),
        fcmToken:  null,
        isOnline:  false,
        status:    'deleted',
        password:  'DELETED',
      }
    });

    console.log(`[DeleteAccount] Rider ${req.user._id} deleted their account.`);
    return ok(res, {}, 'Rider account deleted successfully.');
  } catch (error) {
    next(error);
  }
}