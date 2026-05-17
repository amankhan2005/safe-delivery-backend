import axios from 'axios';

async function sendWhatsAppMessage(to, messageBody) {
  const accessToken   = (process.env.WHATSAPP_ACCESS_TOKEN    || '').trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

  if (!accessToken)   throw new Error('[WhatsApp] WHATSAPP_ACCESS_TOKEN missing in .env');
  if (!phoneNumberId) throw new Error('[WhatsApp] WHATSAPP_PHONE_NUMBER_ID missing in .env');

  const { data } = await axios.post(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      ...messageBody,
    },
    {
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  return data;
}

export async function sendPhoneOTP(to, otp) {
  const expiryMinutes = (process.env.OTP_EXPIRY_MINUTES        || '5').trim();
  const templateName  = (process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'otp_verification').trim();
  const templateLang  = (process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en_US').trim();

  try {
    const result = await sendWhatsAppMessage(to, {
      type: 'template',
      template: {
        name:     templateName,
        language: { code: templateLang },
        components: [
          {
            type:       'body',
            parameters: [
              { type: 'text', text: String(otp)           },
              { type: 'text', text: String(expiryMinutes) },
            ],
          },
        ],
      },
    });
    console.log(`[WhatsApp OTP] Sent to ${to} | WAMID: ${result?.messages?.[0]?.id}`);
    return result?.messages?.[0]?.id;
  } catch (templateErr) {
    console.warn(`[WhatsApp OTP] Template failed (${templateErr.message}) — trying text fallback`);
  }

  const result = await sendWhatsAppMessage(to, {
    type: 'text',
    text: {
      preview_url: false,
      body: `Your Safe Delivery verification code is: *${otp}*\nValid for ${expiryMinutes} minutes. Do not share this code.`,
    },
  });
  console.log(`[WhatsApp OTP] Text fallback sent to ${to} | WAMID: ${result?.messages?.[0]?.id}`);
  return result?.messages?.[0]?.id;
}

export const sendApprovalSms = async (phone, name) => {
  try {
    await sendWhatsAppMessage(phone, {
      type: 'text',
      text: {
        preview_url: false,
        body: `Hello ${name}! 🎉 Your Safe Delivery rider account has been *approved*. You can now log in and start accepting orders.`,
      },
    });
    console.log(`[WhatsApp] Approval sent to ${phone}`);
  } catch (e) {
    console.error(`[WhatsApp] Approval failed for ${phone}:`, e.message);
  }
};

export const sendRejectionSms = async (phone, reason) => {
  try {
    await sendWhatsAppMessage(phone, {
      type: 'text',
      text: {
        preview_url: false,
        body: `Hello! Your Safe Delivery rider application was not approved.\n\n*Reason:* ${reason}\n\nPlease contact support for assistance.`,
      },
    });
    console.log(`[WhatsApp] Rejection sent to ${phone}`);
  } catch (e) {
    console.error(`[WhatsApp] Rejection failed for ${phone}:`, e.message);
  }
};