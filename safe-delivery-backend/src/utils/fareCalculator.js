import mapsService from '../config/maps.js';

const { getDistanceMiles } = mapsService;

/**
 * Get distance
 */
export const getDistance = async (oLat, oLng, dLat, dLng) => {
  return await getDistanceMiles(oLat, oLng, dLat, dLng);
};

/**
 * Calculate fare
 */
export const calculateFare = (miles, costPerMile) => {
  return Math.round(miles * costPerMile * 100) / 100;
};

/**
 * Apply promo
 */
export const applyPromo = (fare, discount, type) => {
  let discountAmount = 0;

  if (type === 'flat') {
    discountAmount = Math.min(discount, fare);
  } else if (type === 'percentage') {
    discountAmount = Math.round((fare * discount / 100) * 100) / 100;
    discountAmount = Math.min(discountAmount, fare);
  }

  const finalFare = Math.round((fare - discountAmount) * 100) / 100;

  return { finalFare, discountAmount };
};