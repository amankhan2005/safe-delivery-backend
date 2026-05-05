/**
 * fareCalculator.js
 *
 * All fare logic in one place:
 *  - calculateFare  : base + per-mile + min fare + optional surge
 *  - applyPromo     : flat or percentage discount
 *  - getDistance    : delegates to maps service (with cache + Haversine fallback)
 */

import mapsService from '../config/maps.js';

const { getDistanceMiles } = mapsService;

// ─── DISTANCE ─────────────────────────────────────────────────────────────────

export const getDistance = async (oLat, oLng, dLat, dLng) => {
  return await getDistanceMiles(oLat, oLng, dLat, dLng);
};

// ─── FARE CALCULATION ─────────────────────────────────────────────────────────

/**
 * Calculate fare given:
 *   miles       — distance in miles
 *   costPerMile — admin-configured price per mile (USD)
 *   options     — optional overrides: { baseFare, minFare, surgeMultiplier }
 *
 * Formula:
 *   raw = baseFare + (miles × costPerMile × surgeMultiplier)
 *   final = max(raw, minFare)
 *
 * Default values (used when not passed in):
 *   baseFare        = 0      (admin can set via pricing)
 *   minFare         = 2.00   (minimum $2 ride)
 *   surgeMultiplier = 1.0    (no surge by default)
 */
export const calculateFare = (miles, costPerMile, options = {}) => {
  const {
    baseFare = 0,
    minFare = 2.0,
    surgeMultiplier = 1.0,
  } = options;

  const raw = baseFare + miles * costPerMile * surgeMultiplier;
  const final = Math.max(raw, minFare);

  return Math.round(final * 100) / 100; // round to 2 decimal places
};

// ─── PROMO CODE ───────────────────────────────────────────────────────────────

/**
 * Apply promo discount to a fare.
 * Returns { finalFare, discountAmount }
 */
export const applyPromo = (fare, discount, type) => {
  let discountAmount = 0;

  if (type === 'flat') {
    discountAmount = Math.min(discount, fare);
  } else if (type === 'percentage') {
    discountAmount = Math.round((fare * discount / 100) * 100) / 100;
    discountAmount = Math.min(discountAmount, fare);
  }

  const finalFare = Math.max(Math.round((fare - discountAmount) * 100) / 100, 0);

  return { finalFare, discountAmount };
};