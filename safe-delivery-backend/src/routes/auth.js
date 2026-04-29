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
const { validateSignup, validateLogin } = require('../middleware/validate');

// ── Customer Auth
router.post('/signup', validateSignup, signup);
router.post('/verify-phone-otp', verifyPhoneOTP);
router.post('/verify-email-otp', verifyEmailOTP);
router.post('/resend-otp', resendOTP);
router.post('/login', validateLogin, login);
router.post('/send-login-otp', sendLoginOTP);
router.post('/verify-login-otp', verifyLoginOTP);
router.post('/resend-login-otp', resendLoginOTP);
router.post('/forgot-password', forgotPassword);
router.post('/resend-forgot-otp', resendForgotOTP);
router.post('/verify-reset-otp', verifyResetOTP);
router.post('/reset-password', resetPassword);
router.post('/change-password', protect, changePassword);
router.get('/me', protect, getMe);
router.post('/fcm-token', protect, saveFcmToken);

// ── Rider Auth
router.post('/rider-signup', validateSignup, riderSignup);
router.post('/rider-verify-phone-otp', riderVerifyPhoneOTP);
router.post('/rider-resend-otp', riderResendOTP);
router.post('/rider-login', validateLogin, riderLogin);
router.post('/rider-send-login-otp', riderSendLoginOTP);
router.post('/rider-verify-login-otp', riderVerifyLoginOTP);
router.post('/rider-resend-login-otp', riderResendLoginOTP);
router.post('/rider-forgot-password', riderForgotPassword);
router.post('/rider-resend-forgot-otp', riderResendForgotOTP);
router.post('/rider-verify-reset-otp', riderVerifyResetOTP);
router.post('/rider-reset-password', riderResetPassword);

module.exports = router;