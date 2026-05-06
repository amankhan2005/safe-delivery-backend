import { Router } from 'express';
const router = Router();

import {
  signup,
  verifyPhoneOTP,
  verifyEmailOTP,
  resendOTP,
  login,
  forgotPassword,
  resendForgotOTP,
  verifyResetOTP,
  resetPassword,
  changePassword,
  getMe,
  saveFcmToken,
  riderSignup,
  riderVerifyPhoneOTP,
  riderVerifyEmailOTP,
  riderResendEmailOTP,
  riderLogin,
  riderForgotPassword,
  riderResendForgotOTP,
  riderVerifyResetOTP,
  riderResetPassword,
  riderChangePassword,
} from '../controllers/authController.js';
import { deleteUserAccount, deleteRiderAccount } from '../controllers/orderController.js';

import { protect, isRider, isCustomer } from '../middleware/auth.js';
import { validateSignup, validateLogin, validateResetPassword } from '../middleware/validate.js';
import { uploadSelfie } from '../middleware/upload.js';

// ── Customer
router.post('/signup',            validateSignup, signup);
router.post('/verify-phone-otp',  verifyPhoneOTP);
router.post('/verify-email-otp',  verifyEmailOTP);
router.post('/resend-otp',        resendOTP);
router.post('/login',             validateLogin, login);
router.post('/forgot-password',   forgotPassword);
router.post('/resend-forgot-otp', resendForgotOTP);
router.post('/verify-reset-otp',  verifyResetOTP);
router.post('/reset-password',    validateResetPassword, resetPassword);
router.post('/change-password',   protect, changePassword);
router.get('/me',                 protect, getMe);
router.post('/fcm-token',         protect, saveFcmToken);

// ── Rider
router.post('/rider-signup',            uploadSelfie, validateSignup, riderSignup);
router.post('/rider-verify-phone-otp',  riderVerifyPhoneOTP);
router.post('/rider-verify-email-otp',  riderVerifyEmailOTP);
router.post('/rider-resend-email-otp',  riderResendEmailOTP);
router.post('/rider-login',             validateLogin, riderLogin);
router.post('/rider-forgot-password',   riderForgotPassword);
router.post('/rider-resend-forgot-otp', riderResendForgotOTP);
router.post('/rider-verify-reset-otp',  riderVerifyResetOTP);
router.post('/rider-reset-password',    validateResetPassword, riderResetPassword);
router.post('/rider-change-password',   protect, isRider, riderChangePassword);

// Delete account
router.delete('/delete-account',       protect, isCustomer, deleteUserAccount);
router.delete('/rider-delete-account', protect, isRider,    deleteRiderAccount);

export default router;