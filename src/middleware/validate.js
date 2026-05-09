import { err } from '../utils/responseHelper.js';
import { normalizePhone, isValidLiberiaPhone } from '../utils/phoneNormalizer.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateSignup = (req, res, next) => {
  const { name, password } = req.body;
  let { phone, email } = req.body;
  const missing = [];

  if (!name || !name.trim()) missing.push('name');
  if (!phone || !phone.trim()) missing.push('phone');
  if (!email || !email.trim()) missing.push('email');
  if (!password) missing.push('password');

  if (missing.length > 0) return err(res, `Missing required fields: ${missing.join(', ')}.`, 400);
  if (password.length < 6) return err(res, 'Password must be at least 6 characters.', 400);
  if (!EMAIL_REGEX.test(email.trim())) return err(res, 'Please provide a valid email address.', 400);

  const normalized = normalizePhone(phone);
  if (!isValidLiberiaPhone(normalized)) return err(res, 'Please provide a valid Liberia phone number.', 400);

  req.body.phone = normalized;
  req.body.email = email.trim().toLowerCase();

  next();
};

export const validateLogin = (req, res, next) => {
  const { password } = req.body;
  let { identifier } = req.body;

  if (!identifier || !identifier.trim()) return err(res, 'Phone number or email is required.', 400);
  if (!password) return err(res, 'Password is required.', 400);

  const trimmed = identifier.trim();
  req.body.identifier = EMAIL_REGEX.test(trimmed)
    ? trimmed.toLowerCase()
    : normalizePhone(trimmed);

  next();
};

export const validateOTPVerify = (req, res, next) => {
  const { otp } = req.body;
  if (!otp || !/^\d{4}$/.test(String(otp).trim())) {
    return err(res, 'A valid 4-digit OTP is required.', 400);
  }
  req.body.otp = String(otp).trim();
  next();
};

export const validateResetPassword = (req, res, next) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !resetToken.trim()) return err(res, 'resetToken is required.', 400);
  if (!newPassword || newPassword.length < 6) return err(res, 'newPassword must be at least 6 characters.', 400);
  next();
};

export const validateOrder = (req, res, next) => {
  const { pickup, drop, parcelWeight } = req.body;
  const validWeights = ['<1lb', '1-5lb', '5-10lb', '>10lb'];

  if (!pickup) return err(res, 'Pickup details are required.', 400);
  if (!drop) return err(res, 'Drop details are required.', 400);

  const pickupFields = ['address', 'lat', 'lng', 'contactName', 'contactPhone'];
  for (const field of pickupFields) {
    if (pickup[field] === undefined || pickup[field] === null || pickup[field] === '') {
      return err(res, `Pickup ${field} is required.`, 400);
    }
  }

  const dropFields = ['address', 'lat', 'lng', 'contactName', 'contactPhone'];
  for (const field of dropFields) {
    if (drop[field] === undefined || drop[field] === null || drop[field] === '') {
      return err(res, `Drop ${field} is required.`, 400);
    }
  }

  if (!parcelWeight || !validWeights.includes(parcelWeight)) {
    return err(res, `parcelWeight must be one of: ${validWeights.join(', ')}.`, 400);
  }

  next();
};