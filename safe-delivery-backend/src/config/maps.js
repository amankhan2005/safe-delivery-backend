const axios = require('axios');

/**
 * Get driving distance in MILES between two coordinates using Google Maps Distance Matrix API.
 * @param {number} originLat
 * @param {number} originLng
 * @param {number} destLat
 * @param {number} destLng
 * @returns {Promise<number>} distance in miles
 */
const getDistanceMiles = async (originLat, originLng, destLat, destLng) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;

  const response = await axios.get(url, {
    params: {
      origins: `${originLat},${originLng}`,
      destinations: `${destLat},${destLng}`,
      units: 'imperial', // returns miles
      key: apiKey,
    },
  });

  const data = response.data;

  if (
    data.status !== 'OK' ||
    !data.rows ||
    !data.rows[0] ||
    !data.rows[0].elements ||
    !data.rows[0].elements[0] ||
    data.rows[0].elements[0].status !== 'OK'
  ) {
    throw new Error('Unable to calculate distance. Check coordinates and API key.');
  }

  const distanceMeters = data.rows[0].elements[0].distance.value;
  const distanceMiles = distanceMeters / 1609.344;
  return Math.round(distanceMiles * 100) / 100;
};

module.exports = { getDistanceMiles };