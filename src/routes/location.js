import { Router } from 'express';
import {
  detectLocation,
  getLocationSuggestions,
  getPlaceDetails,
  validateRideLocations,
  getMapConfig,
} from '../controllers/locationController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// Public — frontend needs map config before auth
router.get('/config', getMapConfig);

// Protected — require login for all others
router.post('/detect', protect, detectLocation);
router.get('/suggestions', protect, getLocationSuggestions);
router.get('/place/:placeId', protect, getPlaceDetails);
router.post('/validate-ride', protect, validateRideLocations);

export default router;