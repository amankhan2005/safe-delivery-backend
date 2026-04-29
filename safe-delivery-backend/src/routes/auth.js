const express = require('express');
const router = express.Router();
const {
  signup,
  verifyPhoneOTP,
  verifyEmailOTP,
  resendOTP,
  login,
  sendLoginOTP,
  verifyLoginOTP,
  resendLoginOTP,
  forgotPassword,
  resendForgotOTP,
  verifyResetOTP,
  resetPassword,
  changePassword,
  getMe,
  saveFcmToken,
  riderSignup,
  riderVerifyPhoneOTP,
  riderResendOTP,
  riderLogin,
  riderSendLoginOTP,
  riderVerifyLoginOTP,
  riderResendLoginOTP,
  riderForgotPassword,
  riderResendForgotOTP,
  riderVerifyResetOTP,
  riderResetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const {
  validateSignup,
  validateLogin,
  validateOTPVerify,
  validateResetPassword,
} = require('../middleware/validate');
const { uploadSelfie } = require('../middleware/upload');

// ── Customer Auth
router.post('/signup', validateSignup, signup);
router.post('/verify-phone-otp', validateOTPVerify, verifyPhoneOTP);
router.post('/verify-email-otp', validateOTPVerify, verifyEmailOTP);
router.post('/resend-otp', resendOTP);
router.post('/login', validateLogin, login);
router.post('/send-login-otp', sendLoginOTP);
router.post('/verify-login-otp', validateOTPVerify, verifyLoginOTP);
router.post('/resend-login-otp', resendLoginOTP);
router.post('/forgot-password', forgotPassword);
router.post('/resend-forgot-otp', resendForgotOTP);
router.post('/verify-reset-otp', validateOTPVerify, verifyResetOTP);
router.post('/reset-password', validateResetPassword, resetPassword);
router.post('/change-password', protect, changePassword);
router.get('/me', protect, getMe);
router.post('/fcm-token', protect, saveFcmToken);

// ── Rider Auth
// uploadSelfie runs BEFORE validateSignup so req.file is ready; both must pass
router.post('/rider-signup', uploadSelfie, validateSignup, riderSignup);
router.post('/rider-verify-phone-otp', validateOTPVerify, riderVerifyPhoneOTP);
router.post('/rider-resend-otp', riderResendOTP);
router.post('/rider-login', validateLogin, riderLogin);
router.post('/rider-send-login-otp', riderSendLoginOTP);
router.post('/rider-verify-login-otp', validateOTPVerify, riderVerifyLoginOTP);
router.post('/rider-resend-login-otp', riderResendLoginOTP);
router.post('/rider-forgot-password', riderForgotPassword);
router.post('/rider-resend-forgot-otp', riderResendForgotOTP);
router.post('/rider-verify-reset-otp', validateOTPVerify, riderVerifyResetOTP);
router.post('/rider-reset-password', validateResetPassword, riderResetPassword);

module.exports = router;