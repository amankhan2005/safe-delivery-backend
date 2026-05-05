import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_NAME  = process.env.RESEND_FROM_NAME || 'Safe Delivery';
const FROM_EMAIL = process.env.RESEND_FROM      || 'noreply@safedelivery.com';
const from = `${FROM_NAME} <${FROM_EMAIL}>`;

const OTP_EXPIRY = process.env.OTP_EXPIRY_MINUTES || 10;

const baseStyle = `font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);`;
const headerStyle = `background: #1a56db; padding: 24px 32px; color: #ffffff;`;
const bodyStyle = `padding: 32px;`;
const footerStyle = `background: #f3f4f6; padding: 16px 32px; font-size: 12px; color: #6b7280; text-align: center;`;

const sendEmail = async (to, subject, html) => {
  console.log('[Email] Sending to:', to, '| Subject:', subject, '| From:', from);
  console.log('[Email] RESEND_API_KEY set:', !!process.env.RESEND_API_KEY);

  try {
    const result = await resend.emails.send({ from, to, subject, html });
    console.log('[Email] Sent successfully. ID:', result?.data?.id || result?.id || JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('[Email] Resend error:', error?.message, '| Status:', error?.statusCode);
    console.error('[Email] Full error:', JSON.stringify(error, null, 2));
    throw new Error(`Failed to send email: ${error?.message || 'Unknown error'}`);
  }
};

export const sendOTPEmail = async (email, name, otp, type = 'email') => {
  const typeLabel = type === 'reset' ? 'password reset' : 'email verification';
  const subject   = `Safe Delivery — Your OTP Code: ${otp}`;
  const otpColor  = type === 'reset' ? '#dc2626' : '#1a56db';
  const otpBg     = type === 'reset' ? '#fef2f2' : '#eff6ff';

  const html = `
    <div style="${baseStyle}">
      <div style="${headerStyle}">
        <h1 style="margin:0;font-size:24px;">Safe Delivery</h1>
        <p style="margin:4px 0 0;opacity:0.85;font-size:14px;">Liberia's Trusted Logistics Partner</p>
      </div>
      <div style="${bodyStyle}">
        <h2 style="color:#1a56db;margin-top:0;">Hi ${name || 'there'},</h2>
        <p style="color:#374151;font-size:16px;">Here is your ${typeLabel} code:</p>
        <div style="text-align:center;margin:32px 0;">
          <div style="display:inline-block;font-size:52px;font-weight:bold;letter-spacing:20px;color:${otpColor};padding:20px 36px;background:${otpBg};border-radius:12px;border:2px solid ${otpColor}30;">
            ${otp}
          </div>
        </div>
        <p style="color:#6b7280;font-size:14px;text-align:center;">
          ⏰ This code expires in <strong>${OTP_EXPIRY} minutes</strong>.<br/>
          🔒 Do not share this code with anyone.
        </p>
        ${type !== 'reset' ? `<p style="color:#374151;font-size:14px;">Use this code to complete your Safe Delivery account setup.</p>` : ''}
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Safe Delivery. All rights reserved.<br/>
        This email was sent to ${email}. If you did not request this, please ignore.
      </div>
    </div>
  `;

  return sendEmail(email, subject, html);
};

export const sendPasswordResetEmail = async (email, name, otp) => {
  return sendOTPEmail(email, name, otp, 'reset');
};

export const sendWelcomeEmail = async (email, name) => {
  const subject = 'Welcome to Safe Delivery! 🎉';
  const html = `
    <div style="${baseStyle}">
      <div style="${headerStyle}">
        <h1 style="margin:0;font-size:24px;">Safe Delivery</h1>
        <p style="margin:4px 0 0;opacity:0.85;">Liberia's Trusted Logistics Partner</p>
      </div>
      <div style="${bodyStyle}">
        <h2 style="color:#1a56db;">Welcome aboard, ${name}! 🎉</h2>
        <p style="color:#374151;line-height:1.6;">
          Your Safe Delivery account is now verified and ready to use.
          You can now send parcels quickly, safely, and reliably across Liberia.
        </p>
        <ul style="color:#374151;line-height:2;">
          <li>📦 Place delivery orders in seconds</li>
          <li>📍 Track your delivery in real-time</li>
          <li>💵 Pay cash on delivery — no cards needed</li>
          <li>🔐 Secure OTP for every delivery</li>
        </ul>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Safe Delivery. All rights reserved.
      </div>
    </div>
  `;
  return sendEmail(email, subject, html);
};

export const sendRiderApprovedEmail = async (email, name) => {
  const subject = '🎉 Your Safe Delivery Rider Account is Approved!';
  const html = `
    <div style="${baseStyle}">
      <div style="${headerStyle}">
        <h1 style="margin:0;font-size:24px;">Safe Delivery</h1>
      </div>
      <div style="${bodyStyle}">
        <h2 style="color:#16a34a;">You're approved, ${name}! 🎉</h2>
        <p style="color:#374151;line-height:1.6;">
          Your Safe Delivery rider account has been reviewed and approved.
          Log in now, go online, and start earning with every delivery!
        </p>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Safe Delivery. All rights reserved.
      </div>
    </div>
  `;
  return sendEmail(email, subject, html);
};