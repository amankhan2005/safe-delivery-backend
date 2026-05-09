import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const twilio  = require('twilio');

let _client = null;

function getClient() {
  if (_client) return _client;
  const sid   = (process.env.TWILIO_ACCOUNT_SID  || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN    || '').trim();
  if (!sid || !token) {
    throw new Error('[Twilio] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing in .env');
  }
  _client = twilio(sid, token);
  return _client;
}

/**
 * Send OTP SMS via Twilio
 * @param {string} to   - E.164 phone e.g. +2310770123456
 * @param {string} otp  - 6-digit code
 */
export async function sendPhoneOTP(to, otp) {
  const client = getClient();
  const from   = (process.env.TWILIO_PHONE_NUMBER || '').trim();

  if (!from) throw new Error('[Twilio] TWILIO_PHONE_NUMBER missing in .env');

  const message = await client.messages.create({
    to,
    from,
    body: `Your Safe Delivery verification code is: ${otp}. Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share this code.`,
  });

  console.log(`[Twilio SMS] Sent to ${to} | SID: ${message.sid} | Status: ${message.status}`);
  return message.sid;
}

// ── Non-OTP approval/rejection SMS (preserved) ───────────────────────────────

export const sendApprovalSms = async (phone, name) => {
  try {
    const client = getClient();
    const from   = (process.env.TWILIO_PHONE_NUMBER || '').trim();
    if (!from) { console.warn('[SMS] TWILIO_PHONE_NUMBER not set'); return; }
    await client.messages.create({
      to: phone,
      from,
      body: `Hello ${name}, your Safe Delivery rider account has been approved! You can now start accepting orders.`,
    });
    console.log(`[Twilio SMS] Approval sent to ${phone}`);
  } catch (e) {
    console.error(`[Twilio SMS] Approval failed for ${phone}:`, e.message);
  }
};

export const sendRejectionSms = async (phone, reason) => {
  try {
    const client = getClient();
    const from   = (process.env.TWILIO_PHONE_NUMBER || '').trim();
    if (!from) { console.warn('[SMS] TWILIO_PHONE_NUMBER not set'); return; }
    await client.messages.create({
      to: phone,
      from,
      body: `Your Safe Delivery rider application was not approved. Reason: ${reason}. Please contact support for help.`,
    });
    console.log(`[Twilio SMS] Rejection sent to ${phone}`);
  } catch (e) {
    console.error(`[Twilio SMS] Rejection failed for ${phone}:`, e.message);
  }
};