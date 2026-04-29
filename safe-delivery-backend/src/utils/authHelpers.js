const User = require('../models/userModel');
const Rider = require('../models/riderModel');
const { generateOTP, saveOTP } = require('./otpGenerator');
const { sendOTPSms } = require('../services/smsService');
const { sendOTPEmail } = require('../services/emailService');
const { normalizePhone } = require('./phoneNormalizer');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Check if identifier is an email address.
 */
const isEmail = (identifier) => EMAIL_REGEX.test(identifier.trim());

/**
 * Find a User by phone (normalized) or email.
 * @param {string} identifier
 * @param {boolean} withPassword
 */
const findUserByIdentifier = async (identifier, withPassword = false) => {
  const trimmed = identifier.trim();
  const query = isEmail(trimmed)
    ? { email: trimmed.toLowerCase() }
    : { phone: normalizePhone(trimmed) };

  return withPassword
    ? User.findOne(query).select('+password')
    : User.findOne(query);
};

/**
 * Find a Rider by phone (normalized) or email.
 * @param {string} identifier
 * @param {boolean} withPassword
 */
const findRiderByIdentifier = async (identifier, withPassword = false) => {
  const trimmed = identifier.trim();
  const query = isEmail(trimmed)
    ? { email: trimmed.toLowerCase() }
    : { phone: normalizePhone(trimmed) };

  return withPassword
    ? Rider.findOne(query).select('+password')
    : Rider.findOne(query);
};

/**
 * Generate OTP, save to DB, and dispatch via SMS + optionally email.
 * @param {string} phone  — normalized phone
 * @param {string} type   — 'phone' | 'login' | 'reset'
 * @param {Object} emailOpts — { email, name } — if provided, also sends email OTP
 */
const generateAndSendOTP = async (phone, type, emailOpts = null) => {
  const otp = generateOTP();
  await saveOTP(phone, otp, type);
  await sendOTPSms(phone, otp);

  if (emailOpts && emailOpts.email) {
    const emailOTP = generateOTP();
    await saveOTP(emailOpts.email.toLowerCase(), emailOTP, 'email');
    await sendOTPEmail(emailOpts.email, emailOpts.name || 'User', emailOTP, 'email');
    return { phoneOtp: otp, emailOtp: emailOTP };
  }

  return { phoneOtp: otp };
};

module.exports = { isEmail, findUserByIdentifier, findRiderByIdentifier, generateAndSendOTP };