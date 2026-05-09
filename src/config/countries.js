/**
 * Country configuration — driven entirely by environment variables.
 * Add a new country by updating ALLOWED_COUNTRIES in .env — no code changes needed.
 *
 * ALLOWED_COUNTRIES=LIBERIA,INDIA
 * DEFAULT_COUNTRY=LIBERIA
 */

export const COUNTRY_CONFIG = {
  LIBERIA: {
    name: 'Liberia',
    code: 'LR',
    environment: 'production',
    currency: 'USD',
    // Approximate bounding box [south, west, north, east]
    bounds: {
      south: 4.35,
      west: -11.49,
      north: 8.55,
      east: -7.37,
    },
    // Google Maps Places autocomplete restriction
    googlePlacesRegion: 'lr',
    // Center coordinates for default map view
    center: { lat: 6.3, lng: -9.4 },
    defaultZoom: 7,
    phonePrefix: '+231',
  },

  INDIA: {
    name: 'India',
    code: 'IN',
    environment: 'testing',
    currency: 'USD', // keep billing in USD even for testing
    bounds: {
      south: 6.75,
      west: 68.11,
      north: 35.67,
      east: 97.4,
    },
    googlePlacesRegion: 'in',
    center: { lat: 20.59, lng: 78.96 },
    defaultZoom: 5,
    phonePrefix: '+91',
  },
};

/**
 * Parse ALLOWED_COUNTRIES env var and return validated list.
 */
export function getAllowedCountries() {
  const raw = process.env.ALLOWED_COUNTRIES || 'LIBERIA';
  return raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => COUNTRY_CONFIG[c]); // only known countries
}

/**
 * Get default country from env.
 */
export function getDefaultCountry() {
  const def = (process.env.DEFAULT_COUNTRY || 'LIBERIA').trim().toUpperCase();
  return COUNTRY_CONFIG[def] ? def : getAllowedCountries()[0];
}

/**
 * Returns the config object for a given country key.
 * Throws if not found or not in allowed list.
 */
export function getCountryConfig(countryKey) {
  const key = countryKey?.toUpperCase();
  const allowed = getAllowedCountries();
  if (!key || !COUNTRY_CONFIG[key]) {
    throw new Error(`Unknown country: ${countryKey}`);
  }
  if (!allowed.includes(key)) {
    throw new Error(`Country ${key} is not enabled. Allowed: ${allowed.join(', ')}`);
  }
  return COUNTRY_CONFIG[key];
}

/**
 * Check whether a lat/lng falls within a country's bounding box.
 * Bounding box is a fast pre-filter; reverse-geocoding is the authoritative check.
 */
export function isWithinBounds(lat, lng, countryKey) {
  const config = getCountryConfig(countryKey);
  const { bounds } = config;
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}

/**
 * Return the country key whose bounding box contains the given coordinates.
 * Returns null if no allowed country matches.
 */
export function detectCountryFromCoords(lat, lng) {
  const allowed = getAllowedCountries();
  for (const key of allowed) {
    if (isWithinBounds(lat, lng, key)) return key;
  }
  return null;
}