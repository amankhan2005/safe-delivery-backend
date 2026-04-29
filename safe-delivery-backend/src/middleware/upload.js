const multer = require('multer');
const { kycStorage, orderPhotoStorage } = require('../config/cloudinary');

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

module.exports = { uploadKYC, uploadPhoto };