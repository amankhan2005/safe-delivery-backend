import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { genSalt, hash, compare } = bcrypt;

const riderSchema = new mongoose.Schema(
  {
    name:     { type: String, required: [true, 'Name is required'], trim: true },
    phone:    { type: String, required: [true, 'Phone is required'], unique: true, trim: true },
    email:    { type: String, required: [true, 'Email is required'], unique: true, lowercase: true, trim: true },
    password: { type: String, required: [true, 'Password is required'], minlength: 6, select: false },
    role:     { type: String, default: 'rider' },
    status:   { type: String, enum: ['pending', 'approved', 'rejected', 'banned'], default: 'pending' },

    kycStep:      { type: Number, default: 1 },
    kycCompleted: { type: Boolean, default: false },

    isPhoneVerified: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },  // ← NEW
    isOnline:        { type: Boolean, default: false },
    fcmToken:        { type: String, default: null },

    dob: { type: String },

    vehicle: {
      type:  { type: String, enum: ['motorcycle', 'bicycle', 'car'] },
      plate: { type: String, trim: true },
      model: { type: String, trim: true },
      color: { type: String, trim: true },
    },

    documents: {
      govtIdFront: { url: String, publicId: String },
      govtIdBack:  { url: String, publicId: String },
      license:     { url: String, publicId: String },
      rcBook:      { url: String, publicId: String },
    },

    selfie: {
      url:        { type: String },
      publicId:   { type: String },
      capturedAt: { type: Date },
    },

    profilePhoto: {
      url:      { type: String, default: null },
      publicId: { type: String, default: null },
    },

    currentLocation: {
      lat: { type: Number },
      lng: { type: Number },
    },

    rating:     { type: Number, default: 0 },
    totalTrips: { type: Number, default: 0 },

    earnings: {
      today: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },

    approvedAt:      { type: Date },
    rejectedAt:      { type: Date },
    rejectionReason: { type: String },
    bannedAt:        { type: Date },
  },
  { timestamps: true }
);

riderSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await genSalt(12);
  this.password = await hash(this.password, salt);
  next();
});

riderSchema.methods.matchPassword = async function (enteredPassword) {
  return await compare(enteredPassword, this.password);
};

export default mongoose.model('Rider', riderSchema);