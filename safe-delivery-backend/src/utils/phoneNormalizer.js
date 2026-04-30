/**
 * Normalize a phone number to Liberia E.164 format: +231XXXXXXXXX
 */
export const normalizePhone = (raw) => {
  if (!raw) return null;

  // remove spaces, dashes, brackets etc.
  let phone = String(raw).replace(/[\s\-().]/g, '');

  // remove + if exists
  if (phone.startsWith('+')) {
    phone = phone.slice(1);
  }

  // remove 00 prefix
  if (phone.startsWith('00')) {
    phone = phone.slice(2);
  }

  // already has country code
  if (phone.startsWith('231')) {
    return `+${phone}`;
  }

  // remove leading 0 (local format)
  if (phone.startsWith('0')) {
    phone = phone.slice(1);
  }

  return `+231${phone}`;
};

/**
 * Validate Liberia phone number
 */
export const isValidLiberiaPhone = (normalized) => {
  return /^\+231\d{8,9}$/.test(normalized);
};