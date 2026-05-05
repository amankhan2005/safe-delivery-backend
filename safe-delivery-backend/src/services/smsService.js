// Twilio REMOVED — Phone OTP is handled by Firebase on frontend

export const sendApprovalSms = async (phone, name) => {
  console.info(`[SMS disabled] Approval for ${name} (${phone})`);
};

export const sendRejectionSms = async (phone, reason) => {
  console.info(`[SMS disabled] Rejection (${phone}): ${reason}`);
};