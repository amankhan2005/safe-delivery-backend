import axios from 'axios';

/**
 * Get driving distance in MILES between two coordinates
 */
const getDistanceMiles = async (originLat, originLng, destLat, destLng) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error('Google Maps API key missing');
  }

  try {
    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      {
        params: {
          origins: `${originLat},${originLng}`,
          destinations: `${destLat},${destLng}`,
          units: 'imperial',
          key: apiKey,
        },
        timeout: 5000, // prevent hanging
      }
    );

    const data = response.data;

    const element = data?.rows?.[0]?.elements?.[0];

    if (data.status !== 'OK' || element?.status !== 'OK') {
      throw new Error('Invalid response from Google Maps API');
    }

    const distanceMeters = element.distance.value;
    const distanceMiles = distanceMeters / 1609.344;

    return Math.round(distanceMiles * 100) / 100;
  } catch (error) {
    console.error('Distance API error:', error.message);
    throw new Error('Failed to calculate distance');
  }
};

export default { getDistanceMiles };