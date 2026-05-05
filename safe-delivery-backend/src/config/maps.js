/**
 * maps.js — Distance calculation service
 *
 * Primary:  Google Distance Matrix API (driving distance, imperial/miles)
 * Fallback: Haversine formula (straight-line distance in miles)
 * Cache:    In-memory, 10-minute TTL, 1000 entries max
 */

import axios from 'axios';

// ─── CACHE ───────────────────────────────────────────────────────────────────

const _distCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 1000;

function _cacheKey(oLat, oLng, dLat, dLng) {
  return `${oLat.toFixed(4)},${oLng.toFixed(4)}->${dLat.toFixed(4)},${dLng.toFixed(4)}`;
}

function _cacheGet(key) {
  const e = _distCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { _distCache.delete(key); return null; }
  return e.value;
}

function _cacheSet(key, value) {
  if (_distCache.size >= CACHE_MAX) {
    _distCache.delete(_distCache.keys().next().value);
  }
  _distCache.set(key, { value, ts: Date.now() });
}

// ─── HAVERSINE FALLBACK ──────────────────────────────────────────────────────

function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

/**
 * Get driving distance in MILES between two coordinates.
 * Falls back to Haversine if Google Maps API is unavailable.
 */
const getDistanceMiles = async (originLat, originLng, destLat, destLng) => {
  const key = _cacheKey(originLat, originLng, destLat, destLng);
  const cached = _cacheGet(key);
  if (cached !== null) return cached;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (apiKey) {
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
          timeout: 6000,
        }
      );

      const data = response.data;
      const element = data?.rows?.[0]?.elements?.[0];

      if (data.status === 'OK' && element?.status === 'OK') {
        const distanceMiles = Math.round((element.distance.value / 1609.344) * 100) / 100;
        _cacheSet(key, distanceMiles);
        return distanceMiles;
      }

      console.warn('Distance Matrix non-OK, Haversine fallback. Status:', data.status);
    } catch (error) {
      console.warn('Distance Matrix error, Haversine fallback:', error.message);
    }
  }

  // Haversine fallback
  const fallback = haversineDistanceMiles(originLat, originLng, destLat, destLng);
  _cacheSet(key, fallback);
  return fallback;
};

export default { getDistanceMiles };