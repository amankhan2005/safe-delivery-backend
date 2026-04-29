const multer = require('multer');
const { kycStorage, orderPhotoStorage, selfieStorage } = require('../config/cloudinary');
const { err } = require('../utils/responseHelper');

const FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only image files (jpg, png) and PDFs are allowed.'), false);
  }
};

const photoFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed for order photos.'), false);
  }
};

/**
 * KYC document upload — Cloudinary, up to 4 files
 */
const uploadKYC = multer({
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
 * Order photo upload — Cloudinary, single file
 */
const uploadPhoto = multer({
  storage: orderPhotoStorage,
  limits: { fileSize: FILE_SIZE_LIMIT },
  fileFilter: photoFilter,
}).single('photo');

/**
 * Selfie upload middleware — single image via Cloudinary selfie storage.
 * Enforces camera-only capture by requiring the X-Capture-Source: camera header.
 * The mobile client MUST set this header only when using the device camera API
 * (e.g. via ImagePicker with mediaTypes=camera or Android/iOS camera intent).
 */
const _selfieMulter = multer({
  storage: selfieStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Selfie must be an image file.'), false);
    }
    cb(null, true);
  },
}).single('selfie');

const uploadSelfie = (req, res, next) => {
  // Require the camera-capture header set by the mobile app
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

module.exports = { uploadKYC, uploadPhoto, uploadSelfie };