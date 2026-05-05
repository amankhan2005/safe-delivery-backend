/**
 * locationService.js
 *
 * Responsibilities:
 *  - Reverse geocode coordinates → address + country
 *  - Forward geocode address → coordinates
 *  - Detect country from coordinates (Google API + bounding-box fallback)
 *  - IP-based country detection fallback
 *  - In-memory LRU cache to avoid redundant API calls
 */

import axios from 'axios';
import { detectCountryFromCoords, getCountryConfig, getAllowedCountries, COUNTRY_CONFIG } from '../config/countries.js';

// ─── SIMPLE IN-MEMORY CACHE ──────────────────────────────────────────────────

const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (_cache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
  _cache.set(key, { value, ts: Date.now() });
}

// ─── GOOGLE MAPS HELPERS ─────────────────────────────────────────────────────

function mapsApiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  return key;
}

/**
 * Reverse geocode: coordinates → { address, countryCode, countryName, formattedComponents }
 */
export async function reverseGeocode(lat, lng) {
  const cacheKey = `rev:${lat.toFixed(5)}:${lng.toFixed(5)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  const response = await axios.get(url, {
    params: { latlng: `${lat},${lng}`, key: mapsApiKey() },
    timeout: 6000,
  });

  if (response.data.status !== 'OK' || !response.data.results.length) {
    throw new Error(`Reverse geocode failed: ${response.data.status}`);
  }

  const result = response.data.results[0];
  const components = result.address_components || [];

  const countryComp = components.find((c) => c.types.includes('country'));
  const countryCode = countryComp?.short_name?.toUpperCase() || null;
  const countryName = countryComp?.long_name || null;

  const out = {
    address: result.formatted_address,
    countryCode,
    countryName,
    placeId: result.place_id,
    components,
  };

  cacheSet(cacheKey, out);
  return out;
}

/**
 * Detect which allowed-country key the coordinates belong to.
 * Primary: Google reverse-geocode country code.
 * Fallback: bounding-box check.
 * Returns null if no allowed country matches.
 */
export async function detectCountryKeyFromCoords(lat, lng) {
  const cacheKey = `ctry:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  const allowed = getAllowedCountries();

  // Build a map of ISO code → country key for fast lookup
  const isoToKey = {};
  for (const key of allowed) {
    isoToKey[COUNTRY_CONFIG[key].code.toUpperCase()] = key;
  }

  try {
    const geo = await reverseGeocode(lat, lng);
    if (geo.countryCode && isoToKey[geo.countryCode]) {
      const result = isoToKey[geo.countryCode];
      cacheSet(cacheKey, result);
      return result;
    }
  } catch (_) {
    // fall through to bounding-box
  }

  // Fallback: bounding-box
  const bbResult = detectCountryFromCoords(lat, lng);
  cacheSet(cacheKey, bbResult);
  return bbResult;
}

/**
 * Detect country from IP address.
 * Uses ip-api.com (free, no key required, 45 req/min limit).
 * Returns country KEY (e.g. "LIBERIA") or null.
 */
export async function detectCountryFromIP(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;

  const cacheKey = `ip:${ip}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  try {
    const resp = await axios.get(`http://ip-api.com/json/${ip}?fields=countryCode`, {
      timeout: 4000,
    });

    if (resp.data?.status === 'success' && resp.data.countryCode) {
      const code = resp.data.countryCode.toUpperCase();
      const allowed = getAllowedCountries();

      // Build ISO→key map
      const isoToKey = {};
      for (const key of allowed) {
        isoToKey[COUNTRY_CONFIG[key].code.toUpperCase()] = key;
      }

      const result = isoToKey[code] || null;
      cacheSet(cacheKey, result);
      return result;
    }
  } catch (_) {
    // silently fail
  }

  cacheSet(cacheKey, null);
  return null;
}

/**
 * Validate that both pickup and drop are in the SAME allowed country.
 * Returns { valid, pickupCountry, dropCountry, error }
 */
export async function validateRideCountries(pickupLat, pickupLng, dropLat, dropLng) {
  const [pickupCountry, dropCountry] = await Promise.all([
    detectCountryKeyFromCoords(pickupLat, pickupLng),
    detectCountryKeyFromCoords(dropLat, dropLng),
  ]);

  if (!pickupCountry) {
    return {
      valid: false,
      pickupCountry,
      dropCountry,
      error: 'Pickup location is outside the supported service area.',
    };
  }

  if (!dropCountry) {
    return {
      valid: false,
      pickupCountry,
      dropCountry,
      error: 'Drop location is outside the supported service area.',
    };
  }

  if (pickupCountry !== dropCountry) {
    return {
      valid: false,
      pickupCountry,
      dropCountry,
      error: `Cross-country rides are not allowed. Pickup is in ${pickupCountry}, drop is in ${dropCountry}.`,
    };
  }

  return { valid: true, pickupCountry, dropCountry, error: null };
}

/**
 * Autocomplete address suggestions restricted to a specific country.
 * countryKey: e.g. 'LIBERIA' | 'INDIA'
 */
export async function getPlaceSuggestions(query, countryKey) {
  if (!query || query.trim().length < 2) return [];

  const config = getCountryConfig(countryKey);
  const cacheKey = `sugg:${countryKey}:${query.trim().toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
  const response = await axios.get(url, {
    params: {
      input: query,
      components: `country:${config.googlePlacesRegion}`,
      key: mapsApiKey(),
    },
    timeout: 6000,
  });

  if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
    throw new Error(`Places autocomplete failed: ${response.data.status}`);
  }

  const suggestions = (response.data.predictions || []).map((p) => ({
    placeId: p.place_id,
    description: p.description,
    mainText: p.structured_formatting?.main_text || p.description,
    secondaryText: p.structured_formatting?.secondary_text || '',
  }));

  cacheSet(cacheKey, suggestions);
  return suggestions;
}

/**
 * Get coordinates from a Google Place ID.
 */
export async function getPlaceCoords(placeId) {
  const cacheKey = `place:${placeId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = 'https://maps.googleapis.com/maps/api/place/details/json';
  const response = await axios.get(url, {
    params: {
      place_id: placeId,
      fields: 'geometry,formatted_address',
      key: mapsApiKey(),
    },
    timeout: 6000,
  });

  if (response.data.status !== 'OK') {
    throw new Error(`Place details failed: ${response.data.status}`);
  }

  const loc = response.data.result?.geometry?.location;
  const out = {
    lat: loc.lat,
    lng: loc.lng,
    address: response.data.result?.formatted_address,
  };

  cacheSet(cacheKey, out);
  return out;
}