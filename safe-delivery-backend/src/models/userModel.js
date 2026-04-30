import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { genSalt, hash, compare } = bcrypt;

const savedAddressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    address: { type: String, trim: true },
    lat: { type: Number },
    lng: { type: Number },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer',
    },
    isPhoneVerified: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    isFirstLogin: { type: Boolean, default: true },
    fcmToken: { type: String, default: null },
    savedAddresses: [savedAddressSchema],
    totalOrders: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const salt = await genSalt(12);
  this.password = await hash(this.password, salt);
  next();
});

// compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await compare(enteredPassword, this.password);
};

export default mongoose.model('User', userSchema);