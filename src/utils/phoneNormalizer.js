/**
 * Normalize a phone number to Liberia E.164 format: +231XXXXXXXXX
 */
export const normalizePhone = (raw) => {
  if (!raw) return null;

  // Strip everything except digits
  let digits = String(raw).replace(/\D/g, '');

  if (!digits) return null;

  // Strip leading 00 (international dialing prefix)
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Already has Liberia country code
  if (digits.startsWith('231')) {
    return `+${digits}`;
  }

  // Local number starting with 0
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return `+231${digits}`;
};

/**
 * Validate Liberia phone number: +231 followed by 7–9 digits
 */
export const isValidLiberiaPhone = (normalized) => {
  if (!normalized) return false;
  return /^\+231\d{7,9}$/.test(normalized);
};

/**
 * Check if two raw phone inputs refer to the same normalized number
 */
export const isSamePhone = (raw1, raw2) => {
  const a = normalizePhone(raw1);
  const b = normalizePhone(raw2);
  return !!a && !!b && a === b;
};