import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_PHONE_NUMBER;

// validate env (important)
if (!accountSid || !authToken || !from) {
  console.warn('⚠️ Twilio env variables missing. SMS may fail.');
}

const client = twilio(accountSid, authToken);

/**
 * Generic SMS sender
 */
const sendSMS = async (to, body) => {
  try {
    const message = await client.messages.create({
      from,
      to,
      body,
    });

    return message;
  } catch (error) {
    console.error('Twilio SMS error:', error.message);
    throw new Error('Failed to send SMS. Please try again.');
  }
};

/**
 * OTP SMS
 */
export const sendOTPSms = async (phone, otp) => {
  const body = `Your Safe Delivery verification code is: ${otp}. Valid for ${
    process.env.OTP_EXPIRY_MINUTES || 10
  } minutes. Do not share this code.`;

  return sendSMS(phone, body);
};

/**
 * Resend OTP
 */
export const resendOTPSms = async (phone, otp) => {
  const body = `Your new Safe Delivery verification code is: ${otp}. Valid for ${
    process.env.OTP_EXPIRY_MINUTES || 10
  } minutes. Do not share this code.`;

  return sendSMS(phone, body);
};

/**
 * Password reset OTP
 */
export const sendResetOTPSms = async (phone, otp) => {
  const body = `Your Safe Delivery password reset code is: ${otp}. Valid for ${
    process.env.OTP_EXPIRY_MINUTES || 10
  } minutes. If you did not request this, ignore this message.`;

  return sendSMS(phone, body);
};

/**
 * Rider approved
 */
export const sendApprovalSms = async (phone, name) => {
  const body = `Hi ${name}, your Safe Delivery rider account has been approved! You can now log in and start accepting deliveries.`;

  return sendSMS(phone, body);
};

/**
 * Rider rejected
 */
export const sendRejectionSms = async (phone, reason) => {
  const body = `Your Safe Delivery rider application was not approved. Reason: ${reason}. Contact support for help.`;

  return sendSMS(phone, body);
};