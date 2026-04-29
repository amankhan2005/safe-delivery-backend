/**
 * Normalize a phone number to Liberia E.164 format: +231XXXXXXXXX
 *
 * Handles:
 *   0771234567   → +231771234567
 *   231771234567 → +231771234567
 *   +231771234567 → +231771234567
 *   077 123 4567 → +231771234567
 *   077-123-4567 → +231771234567
 */
const normalizePhone = (raw) => {
  if (!raw) return null;

  // Strip all whitespace, dashes, dots, parentheses
  let phone = String(raw).replace(/[\s\-().]/g, '');

  // Already has + prefix
  if (phone.startsWith('+')) {
    phone = phone.slice(1);
  }

  // Strip leading 00 (international dialing prefix)
  if (phone.startsWith('00')) {
    phone = phone.slice(2);
  }

  // Has country code 231 already (no leading 0)
  if (phone.startsWith('231')) {
    return `+${phone}`;
  }

  // Starts with leading 0 (local format, e.g. 0771234567)
  if (phone.startsWith('0')) {
    phone = phone.slice(1);
  }

  return `+231${phone}`;
};

/**
 * Validate that a normalized phone matches +231 followed by 8–9 digits.
 */
const isValidLiberiaPhone = (normalized) => {
  return /^\+231\d{8,9}$/.test(normalized);
};

module.exports = { normalizePhone, isValidLiberiaPhone };