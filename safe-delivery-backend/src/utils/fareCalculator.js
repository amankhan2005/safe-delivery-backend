const { getDistanceMiles } = require('../config/maps');

/**
 * Get distance in miles between two coordinates.
 */
const getDistance = async (oLat, oLng, dLat, dLng) => {
  return await getDistanceMiles(oLat, oLng, dLat, dLng);
};

/**
 * Calculate fare based on distance and cost per mile.
 * @param {number} miles
 * @param {number} costPerMile
 * @returns {number} fare rounded to 2 decimals
 */
const calculateFare = (miles, costPerMile) => {
  return Math.round(miles * costPerMile * 100) / 100;
};

/**
 * Apply promo discount to a fare.
 * @param {number} fare
 * @param {number} discount
 * @param {'flat'|'percentage'} type
 * @returns {{ finalFare: number, discountAmount: number }}
 */
const applyPromo = (fare, discount, type) => {
  let discountAmount = 0;

  if (type === 'flat') {
    discountAmount = Math.min(discount, fare);
  } else if (type === 'percentage') {
    discountAmount = Math.round(((fare * discount) / 100) * 100) / 100;
    discountAmount = Math.min(discountAmount, fare);
  }

  const finalFare = Math.round((fare - discountAmount) * 100) / 100;
  return { finalFare, discountAmount };
};

module.exports = { getDistance, calculateFare, applyPromo };