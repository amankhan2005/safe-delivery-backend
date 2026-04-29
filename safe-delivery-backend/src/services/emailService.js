const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const from = `${process.env.RESEND_FROM_NAME || 'Safe Delivery'} <${process.env.RESEND_FROM || 'noreply@safedelivery.com'}>`;

const baseStyle = `
  font-family: Arial, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
`;

const headerStyle = `
  background: #1a56db;
  padding: 24px 32px;
  color: #ffffff;
`;

const bodyStyle = `padding: 32px;`;

const footerStyle = `
  background: #f3f4f6;
  padding: 16px 32px;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
`;

const sendEmail = async (to, subject, html) => {
  try {
    const result = await resend.emails.send({ from, to, subject, html });
    return result;
  } catch (error) {
    console.error('Resend email error:', error.message);
    throw new Error('Failed to send email.');
  }
};

const sendWelcomeEmail = async (email, name) => {
  const subject = 'Welcome to Safe Delivery! 🎉';
  const html = `
    <div style="${baseStyle}">
      <div style="${headerStyle}">
        <h1 style="margin:0;font-size:24px;">Safe Delivery</h1>
        <p style="margin:4px 0 0;opacity:0.85;">Liberia's Trusted Logistics Partner</p>
      </div>
      <div style="${bodyStyle}">
        <h2 style="color:#1a56db;">Welcome, ${name}! 👋</h2>
        <p style="color:#374151;line-height:1.6;">
          We're thrilled to have you on board. With Safe Delivery, you can send parcels
          quickly, safely, and reliably across Liberia.
        </p>
        <p style="color:#374151;line-height:1.6;">Here's what you can do:</p>
        <ul style="color:#374151;line-height:2;">
          <li>Place delivery orders in seconds</li>
          <li>Track your delivery in real-time</li>
          <li>Pay cash on delivery — no cards needed</li>
          <li>Receive a secure OTP for every delivery</li>
        </ul>
        <p style="color:#374151;">If you have any questions, our support team is here to help.</p>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Safe Delivery. All rights reserved.<br/>
        This email was sent to ${email}.
      </div>
    </div>
  `;
  return sendEmail(email, subject, html);
};

const sendOTPEmail = async (email, name, otp, type) => {
  const typeLabel = type === 'email' ? 'email verification' : type === 'reset' ? 'password reset' : 'verification';
  const subject = `Safe Delivery — Your OTP Code`;
  const html = `
    <div style="${baseStyle}">
      <div style="${headerStyle}">
        <h1 style="margin:0;font-size:24px;">Safe Delivery</h1>
      </div>
      <div style="${bodyStyle}">
        <h2 style="color:#1a56db;">Hi ${name},</h2>
        <p style="color:#374151;">Here is your ${typeLabel} code:</p>
        <div style="text-align:center;margin:32px 0;">
          <span style="
            display:inline-block;
            font-size:48px;
            font-weight:bold;
            letter-spacing:16px;
            color:#1a56db;
            padding:16px 32px;
            background:#eff6ff;
            border-radius:8px;
          ">${otp}</span>
        </div>
        <p style="color:#6b7280;font-size:14px;">
          This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share it with anyone.
        </p>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Safe Delivery. All rights reserved.
      </div>
    </div>
  `;
  return sendEmail(email, subject, html);
};

const sendPasswordResetEmail = async (email, name, otp) => {
  const subject = 'Safe Delivery — Password Reset Request';
  const html = `
    <div style="${baseStyle}">
      <div style="${headerStyle}">
        <h1 style="margin:0;font-size:24px;">Safe Delivery</h1>
      </div>
      <div style="${bodyStyle}">
        <h2 style="color:#1a56db;">Password Reset, ${name}</h2>
        <p style="color:#374151;">We received a request to reset your password. Use the code below:</p>
        <div style="text-align:center;margin:32px 0;">
          <span style="
            display:inline-block;
            font-size:48px;
            font-weight:bold;
            letter-spacing:16px;
            color:#dc2626;
            padding:16px 32px;
            background:#fef2f2;
            border-radius:8px;
          ">${otp}</span>
        </div>
        <p style="color:#6b7280;font-size:14px;">
          Expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you did not request this, ignore this email.
        </p>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Safe Delivery.
      </div>
    </div>
  `;
  return sendEmail(email, subject, html);
};

const sendRiderApprovedEmail = async (email, name) => {
  const subject = 'Congratulations — Your Safe Delivery Rider Account is Approved!';
  const html = `
    <div style="${baseStyle}">
      <div style="${headerStyle}">
        <h1 style="margin:0;font-size:24px;">Safe Delivery</h1>
      </div>
      <div style="${bodyStyle}">
        <h2 style="color:#16a34a;">You're approved, ${name}! 🎉</h2>
        <p style="color:#374151;line-height:1.6;">
          Your Safe Delivery rider account has been reviewed and approved. 
          You can now log in, go online, and start earning with every delivery.
        </p>
        <p style="color:#374151;">Tips for getting started:</p>
        <ul style="color:#374151;line-height:2;">
          <li>Log in and toggle your status to "Online"</li>
          <li>Keep your location updated</li>
          <li>Deliver with care and build your rating</li>
        </ul>
        <p style="color:#374151;">Welcome to the Safe Delivery family!</p>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Safe Delivery. All rights reserved.
      </div>
    </div>
  `;
  return sendEmail(email, subject, html);
};

module.exports = {
  sendWelcomeEmail,
  sendOTPEmail,
  sendPasswordResetEmail,
  sendRiderApprovedEmail,
};