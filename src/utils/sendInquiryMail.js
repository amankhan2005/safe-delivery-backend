import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const from = `${process.env.RESEND_FROM_NAME || 'Safe Delivery'} <${process.env.RESEND_FROM || 'noreply@safedelivery.com'}>`;

const sendInquiryMail = async ({ firstName, lastName, email, phone, role, message }) => {
  const subject = `New Inquiry from ${firstName} ${lastName}`;
  const roleLabel = role === 'driver' ? 'Driver' : 'Customer';
  const roleColor = role === 'driver' ? '#E8212B' : '#1A6FD4';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background-color: #F7F8FA;
      color: #1a1a2e;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(11, 31, 75, 0.10);
    }
    .header {
      background: linear-gradient(135deg, #0B1F4B 0%, #1A6FD4 100%);
      padding: 36px 40px 32px;
      text-align: center;
    }
    .header-logo {
      font-size: 22px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.5px;
    }
    .header-logo span {
      color: #E8212B;
    }
    .header-tagline {
      font-size: 12px;
      color: rgba(255,255,255,0.65);
      margin-top: 4px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .badge {
      display: inline-block;
      margin-top: 20px;
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.25);
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 16px;
      border-radius: 999px;
      letter-spacing: 0.5px;
    }
    .body {
      padding: 36px 40px;
    }
    .title {
      font-size: 20px;
      font-weight: 700;
      color: #0B1F4B;
      margin-bottom: 6px;
    }
    .subtitle {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 28px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 20px;
    }
    .info-card {
      background: #F7F8FA;
      border: 1px solid #E8ECF4;
      border-radius: 10px;
      padding: 14px 16px;
    }
    .info-label {
      font-size: 11px;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 4px;
    }
    .info-value {
      font-size: 14px;
      font-weight: 600;
      color: #1a1a2e;
      word-break: break-word;
    }
    .role-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 13px;
      font-weight: 700;
      color: ${roleColor};
      background: ${role === 'driver' ? '#FFF0F0' : '#EEF3FF'};
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid ${role === 'driver' ? '#fecaca' : '#bfdbfe'};
    }
    .message-section {
      margin-top: 4px;
    }
    .message-label {
      font-size: 12px;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 10px;
    }
    .message-box {
      background: linear-gradient(135deg, #EEF3FF 0%, #F7F8FA 100%);
      border-left: 4px solid #1A6FD4;
      border-radius: 0 10px 10px 0;
      padding: 18px 20px;
      font-size: 14px;
      color: #374151;
      line-height: 1.7;
      font-style: italic;
    }
    .divider {
      height: 1px;
      background: #E8ECF4;
      margin: 28px 0;
    }
    .action-note {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 10px;
      padding: 14px 18px;
      font-size: 13px;
      color: #92400e;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .action-note-icon {
      font-size: 16px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .footer {
      background: #F7F8FA;
      border-top: 1px solid #E8ECF4;
      padding: 20px 40px;
      text-align: center;
    }
    .footer-text {
      font-size: 12px;
      color: #9ca3af;
      line-height: 1.6;
    }
    .footer-brand {
      font-weight: 700;
      color: #0B1F4B;
    }
    @media (max-width: 480px) {
      .wrapper { margin: 0; border-radius: 0; }
      .body { padding: 24px 20px; }
      .header { padding: 24px 20px; }
      .info-grid { grid-template-columns: 1fr; }
      .footer { padding: 16px 20px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">

    <!-- Header -->
    <div class="header">
      <div class="header-logo">SAFE <span>DELIVERY</span></div>
      <div class="header-tagline">Fast · Secure · Trusted</div>
      <div class="badge">📩 New Support Inquiry</div>
    </div>

    <!-- Body -->
    <div class="body">
      <div class="title">New Inquiry Received</div>
      <div class="subtitle">Someone has submitted a support request. Please respond promptly.</div>

      <!-- Info Grid -->
      <div class="info-grid">
        <div class="info-card">
          <div class="info-label">Full Name</div>
          <div class="info-value">${firstName} ${lastName}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Role</div>
          <div class="info-value">
            <span class="role-badge">
              ${role === 'driver' ? '🏍️' : '📦'} ${roleLabel}
            </span>
          </div>
        </div>
        <div class="info-card">
          <div class="info-label">Email Address</div>
          <div class="info-value">${email}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Phone Number</div>
          <div class="info-value">${phone}</div>
        </div>
      </div>

      <!-- Message -->
      <div class="message-section">
        <div class="message-label">Message</div>
        <div class="message-box">"${message}"</div>
      </div>

      <div class="divider"></div>

      <!-- Action Note -->
      <div class="action-note">
        <div class="action-note-icon">⚡</div>
        <div>
          <strong>Action Required:</strong> Please review this inquiry and respond to
          <strong>${email}</strong> within 24 hours.
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-text">
        This email was automatically generated by the <span class="footer-brand">Safe Delivery</span> support system.<br/>
        © ${new Date().getFullYear()} Safe Delivery — Liberia's Trusted Logistics Partner
      </div>
    </div>

  </div>
</body>
</html>
  `;

  const result = await resend.emails.send({
    from,
    to: 'support@safedelivery.com',
    replyTo: email,
    subject,
    html,
  });

  return result;
};

export default sendInquiryMail;