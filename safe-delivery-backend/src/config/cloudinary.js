import cloudinaryPkg from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const { v2: cloudinary } = cloudinaryPkg;

// config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── KYC STORAGE ─────────────────────────
const kycStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'safe-delivery/kyc',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  }),
});

// ─── ORDER PHOTOS ───────────────────────
const orderPhotoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'safe-delivery/order-photos',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  }),
});

// ─── SELFIE STORAGE ─────────────────────
const selfieStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'safe-delivery/selfies',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    transformation: [
      { quality: 'auto', fetch_format: 'auto', width: 800, crop: 'limit' },
    ],
  }),
});

export default {
  cloudinary,
  kycStorage,
  orderPhotoStorage,
  selfieStorage,
};