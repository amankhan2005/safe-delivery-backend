import multer from 'multer';
import cloudinaryConfig from '../config/cloudinary.js';
import { err } from '../utils/responseHelper.js';

const { kycStorage, orderPhotoStorage, selfieStorage } = cloudinaryConfig;

const FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

const imageFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith('image/') ||
    file.mimetype === 'application/pdf'
  ) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (jpg, png) and PDFs are allowed.'), false);
  }
};

const photoFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(
      new Error('Only image files are allowed for order photos.'),
      false
    );
  }
};

/**
 * KYC upload
 */
export const uploadKYC = multer({
  storage: kycStorage,
  limits: { fileSize: FILE_SIZE_LIMIT },
  fileFilter: imageFilter,
}).fields([
  { name: 'govtIdFront', maxCount: 1 },
  { name: 'govtIdBack', maxCount: 1 },
  { name: 'license', maxCount: 1 },
  { name: 'rcBook', maxCount: 1 },
]);

/**
 * Order photo upload
 */
export const uploadPhoto = multer({
  storage: orderPhotoStorage,
  limits: { fileSize: FILE_SIZE_LIMIT },
  fileFilter: photoFilter,
}).single('photo');

/**
 * Selfie upload (camera only)
 */
const _selfieMulter = multer({
  storage: selfieStorage,
  limits: { fileSize: FILE_SIZE_LIMIT },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Selfie must be an image file.'), false);
    }
    cb(null, true);
  },
}).single('selfie');

export const uploadSelfie = (req, res, next) => {
  const captureSource = req.headers['x-capture-source'];

  if (!captureSource || captureSource.toLowerCase() !== 'camera') {
    return err(
      res,
      'Selfie must be taken using the device camera. Gallery uploads are not allowed.',
      400
    );
  }

  _selfieMulter(req, res, (multerErr) => {
    if (multerErr) return next(multerErr);
    next();
  });
};