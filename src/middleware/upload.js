import multer from 'multer';
import cloudinaryConfig from '../config/cloudinary.js';
import { err } from '../utils/responseHelper.js';

const {
  kycStorage, orderPhotoStorage, selfieStorage, profilePhotoStorage,
} = cloudinaryConfig;

// 10MB hard cap — generous for proof-of-delivery photos without quality loss.
// Cloudinary will optimize server-side via our transformation params.
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;

// All MIME types React Native / Android can send for camera images.
// "application/octet-stream" is the fallback when the OS doesn't recognise
// the MIME type (common with HEIC on older Android firmware).
const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'application/octet-stream', // Android fallback
]);

const imageFilter = (req, file, cb) => {
  if (IMAGE_MIMES.has(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), false);
  }
};

const photoFilter = (req, file, cb) => {
  // Accept anything that could plausibly be an image.
  // Let Cloudinary reject genuinely invalid formats — it gives a clearer error.
  if (IMAGE_MIMES.has(file.mimetype) || file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: jpg, png, heic.`), false);
  }
};

// ─── GENERIC MULTER WRAPPER ──────────────────────────────────────────────────
// Converts multer callback-style to Express next() error forwarding.
// IMPORTANT: Do NOT swallow multer errors here — pass them all to next()
// so the global errorHandler can send a clean JSON response.
function multerWrap(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (multerErr) => {
      if (!multerErr) return next();

      // Enrich the error with a human-readable message for the error handler
      if (multerErr instanceof multer.MulterError) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          multerErr.message = 'Photo too large. Maximum 10MB per photo.';
        } else if (multerErr.code === 'LIMIT_UNEXPECTED_FILE') {
          multerErr.message = `Unexpected field: ${multerErr.field}. Expected "photo".`;
        }
      }

      return next(multerErr);
    });
  };
}

// ─── UPLOAD MIDDLEWARES ──────────────────────────────────────────────────────

export const uploadKYC = multerWrap(
  multer({
    storage:    kycStorage,
    limits:     { fileSize: FILE_SIZE_LIMIT },
    fileFilter: imageFilter,
  }).fields([
    { name: 'govtIdFront', maxCount: 1 },
    { name: 'govtIdBack',  maxCount: 1 },
    { name: 'license',     maxCount: 1 },
    { name: 'rcBook',      maxCount: 1 },
  ])
);

export const uploadPhoto = multerWrap(
  multer({
    storage:    orderPhotoStorage,
    limits:     { fileSize: FILE_SIZE_LIMIT },
    fileFilter: photoFilter,
  }).single('photo')
);

export const uploadProfilePhoto = multerWrap(
  multer({
    storage:    profilePhotoStorage,
    limits:     { fileSize: FILE_SIZE_LIMIT },
    fileFilter: photoFilter,
  }).single('photo')
);

const _selfieMulter = multer({
  storage:    selfieStorage,
  limits:     { fileSize: FILE_SIZE_LIMIT },
  fileFilter: photoFilter,
}).single('selfie');

export const uploadSelfie = (req, res, next) => {
  const captureSource = req.headers['x-capture-source'];
  if (!captureSource || captureSource.toLowerCase() !== 'camera') {
    return err(res, 'Selfie must be taken using the device camera.', 400);
  }
  _selfieMulter(req, res, (multerErr) => {
    if (multerErr) return next(multerErr);
    next();
  });
};