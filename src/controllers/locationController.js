/**
 * locationController.js
 *
 * Endpoints:
 *   POST /api/location/detect          — auto-detect country from GPS or IP
 *   GET  /api/location/suggestions     — autocomplete restricted to user's country
 *   GET  /api/location/place/:placeId  — resolve placeId → lat/lng
 *   POST /api/location/validate-ride   — validate pickup+drop are same country
 *   GET  /api/location/config          — return country config for frontend map setup
 */

import { ok, err } from '../utils/responseHelper.js';
import {
  detectCountryKeyFromCoords,
  detectCountryFromIP,
  getPlaceSuggestions,
  getPlaceCoords,
  validateRideCountries,
  reverseGeocode,
} from '../services/locationService.js';
import { getCountryConfig, getAllowedCountries, COUNTRY_CONFIG } from '../config/countries.js';

// ─── DETECT LOCATION ─────────────────────────────────────────────────────────

/**
 * POST /api/location/detect
 * Body: { lat?, lng? }
 * If lat/lng provided → GPS detection.
 * Else → IP-based detection.
 */
export async function detectLocation(req, res, next) {
  try {
    const { lat, lng } = req.body;

    let countryKey = null;
    let detectionMethod = 'ip';
    let address = null;

    if (lat !== undefined && lng !== undefined) {
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);

      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        return err(res, 'Invalid lat/lng values.', 400);
      }

      countryKey = await detectCountryKeyFromCoords(parsedLat, parsedLng);
      detectionMethod = 'gps';

      // Attempt to get address
      try {
        const geo = await reverseGeocode(parsedLat, parsedLng);
        address = geo.address;
      } catch (_) {}
    } else {
      // IP-based fallback
      const ip =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        '';
      countryKey = await detectCountryFromIP(ip);
      detectionMethod = 'ip';
    }

    if (!countryKey) {
      // Default to the default country if detection fails
      const allowed = getAllowedCountries();
      countryKey = allowed[0];
      detectionMethod = 'default';
    }

    const config = getCountryConfig(countryKey);

    return ok(res, {
      countryKey,
      country: config.name,
      countryCode: config.code,
      environment: config.environment,
      center: config.center,
      bounds: config.bounds,
      defaultZoom: config.defaultZoom,
      currency: config.currency,
      detectionMethod,
      address,
    }, 'Location detected.');
  } catch (error) {
    next(error);
  }
}

// ─── AUTOCOMPLETE SUGGESTIONS ────────────────────────────────────────────────

/**
 * GET /api/location/suggestions?q=...&country=LIBERIA
 */
export async function getLocationSuggestions(req, res, next) {
  try {
    const { q, country } = req.query;

    if (!q || q.trim().length < 2) {
      return err(res, 'Query (q) must be at least 2 characters.', 400);
    }

    if (!country) {
      return err(res, 'country query param is required (e.g. ?country=LIBERIA).', 400);
    }

    const allowed = getAllowedCountries();
    const countryKey = country.toUpperCase();

    if (!allowed.includes(countryKey)) {
      return err(res, `Country ${countryKey} is not supported. Allowed: ${allowed.join(', ')}`, 400);
    }

    const suggestions = await getPlaceSuggestions(q, countryKey);

    return ok(res, { suggestions, country: countryKey }, 'Suggestions fetched.');
  } catch (error) {
    next(error);
  }
}

// ─── PLACE DETAILS ───────────────────────────────────────────────────────────

/**
 * GET /api/location/place/:placeId
 */
export async function getPlaceDetails(req, res, next) {
  try {
    const { placeId } = req.params;

    if (!placeId) {
      return err(res, 'placeId is required.', 400);
    }

    const details = await getPlaceCoords(placeId);

    return ok(res, details, 'Place details fetched.');
  } catch (error) {
    next(error);
  }
}

// ─── VALIDATE RIDE LOCATIONS ─────────────────────────────────────────────────

/**
 * POST /api/location/validate-ride
 * Body: { pickupLat, pickupLng, dropLat, dropLng }
 */
export async function validateRideLocations(req, res, next) {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng } = req.body;

    if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
      return err(res, 'pickupLat, pickupLng, dropLat, dropLng are required.', 400);
    }

    const result = await validateRideCountries(
      parseFloat(pickupLat),
      parseFloat(pickupLng),
      parseFloat(dropLat),
      parseFloat(dropLng)
    );

    if (!result.valid) {
      return err(res, result.error, 422);
    }

    const config = getCountryConfig(result.pickupCountry);

    return ok(res, {
      valid: true,
      country: result.pickupCountry,
      countryName: config.name,
      environment: config.environment,
    }, 'Locations validated successfully.');
  } catch (error) {
    next(error);
  }
}

// ─── COUNTRY MAP CONFIG ───────────────────────────────────────────────────────

/**
 * GET /api/location/config?country=LIBERIA
 * Returns map configuration for the frontend.
 */
export async function getMapConfig(req, res, next) {
  try {
    const allowed = getAllowedCountries();

    // If specific country requested
    const countryKey = req.query.country?.toUpperCase();
    if (countryKey) {
      if (!allowed.includes(countryKey)) {
        return err(res, `Country ${countryKey} is not supported.`, 400);
      }

      const config = COUNTRY_CONFIG[countryKey];
      return ok(res, {
        countryKey,
        ...config,
        googleMapsKey: process.env.GOOGLE_MAPS_API_KEY,
      }, 'Map config fetched.');
    }

    // Return all allowed countries
    const configs = allowed.map((key) => ({
      countryKey: key,
      ...COUNTRY_CONFIG[key],
    }));

    return ok(res, {
      allowedCountries: configs,
      googleMapsKey: process.env.GOOGLE_MAPS_API_KEY,
    }, 'Map configs fetched.');
  } catch (error) {
    next(error);
  }
}