const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const from = process.env.TWILIO_PHONE_NUMBER;

const sendSMS = async (to, body) => {
  try {
    const message = await client.messages.create({ from, to, body });
    return message;
  } catch (error) {
    console.error('Twilio SMS error:', error.message);
    throw new Error('Failed to send SMS. Please try again.');
  }
};

const sendOTPSms = async (phone, otp) => {
  const body = `Your Safe Delivery verification code is: ${otp}. Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share this code.`;
  return sendSMS(phone, body);
};

const resendOTPSms = async (phone, otp) => {
  const body = `Your new Safe Delivery verification code is: ${otp}. Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share this code.`;
  return sendSMS(phone, body);
};

const sendResetOTPSms = async (phone, otp) => {
  const body = `Your Safe Delivery password reset code is: ${otp}. Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you did not request this, ignore this message.`;
  return sendSMS(phone, body);
};

const sendApprovalSms = async (phone, name) => {
  const body = `Hi ${name}, your Safe Delivery rider account has been approved! You can now log in and start accepting deliveries. Welcome to the team!`;
  return sendSMS(phone, body);
};

const sendRejectionSms = async (phone, reason) => {
  const body = `Your Safe Delivery rider application has been reviewed. Unfortunately, it was not approved at this time. Reason: ${reason}. Contact support for assistance.`;
  return sendSMS(phone, body);
};

module.exports = {
  sendOTPSms,
  resendOTPSms,
  sendResetOTPSms,
  sendApprovalSms,
  sendRejectionSms,
};