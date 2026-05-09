import cloudinaryPkg from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

const { v2: cloudinary } = cloudinaryPkg;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  // 90s upload timeout — enough for large files on slow connections without
  // hitting Render's 30s request timeout (the upload goes Render → Cloudinary
  // over a fast server-side connection, so 90s is very generous).
  timeout:    90_000,
});

// ─── KYC DOCUMENTS ───────────────────────────────────────────────────────────
// Keep documents legible — 1600px wide, quality:auto (Cloudinary picks the
// best compression that preserves readability). No crop.
const kycStorage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder:          'safe-delivery/kyc',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'heic', 'heif'],
    transformation:  [{
      width:        1600,
      crop:         'limit',
      quality:      'auto:good',  // Cloudinary's smart compress — keeps text sharp
      fetch_format: 'auto',
    }],
    unique_filename: true,
  }),
});

// ─── ORDER PROOF PHOTOS ───────────────────────────────────────────────────────
// These are legal proof-of-pickup / proof-of-delivery photos.
// REQUIREMENT: High quality, no blurring, no heavy compression.
// Strategy: cap at 1600px (reduces file size ~60% on a 4K phone photo),
// quality:auto:good (Cloudinary's perceptual quality target — keeps detail
// without unnecessary bytes), fetch_format:auto (serves WebP to modern clients).
// This gives clear, sharp images at ~200-400KB instead of 3-8MB originals.
const orderPhotoStorage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder:          'safe-delivery/order-photos',
    allowed_formats: ['jpg', 'jpeg', 'png', 'heic', 'heif'],
    transformation:  [{
      width:        1600,
      crop:         'limit',
      quality:      'auto:good',
      fetch_format: 'auto',
    }],
    unique_filename: true,
  }),
});

// ─── SELFIES ─────────────────────────────────────────────────────────────────
const selfieStorage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder:          'safe-delivery/selfies',
    allowed_formats: ['jpg', 'jpeg', 'png', 'heic', 'heif'],
    transformation:  [{
      width:        900,
      height:       900,
      crop:         'limit',
      quality:      'auto:good',
      fetch_format: 'auto',
    }],
    unique_filename: true,
  }),
});

// ─── PROFILE PHOTOS ───────────────────────────────────────────────────────────
const profilePhotoStorage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder:          'safe-delivery/profiles',
    allowed_formats: ['jpg', 'jpeg', 'png', 'heic', 'heif'],
    transformation:  [{
      width:        400,
      height:       400,
      crop:         'fill',
      gravity:      'face',
      quality:      'auto:good',
      fetch_format: 'auto',
    }],
    unique_filename: true,
  }),
});

export default {
  cloudinary,
  kycStorage,
  orderPhotoStorage,
  selfieStorage,
  profilePhotoStorage,
};