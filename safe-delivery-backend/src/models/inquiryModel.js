import { Schema, model } from 'mongoose';

const inquirySchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },

    // ✅ FIX: optional
    lastName: {
      type: String,
      default: '',   // ❗ required hata diya
      trim: true,
    },

    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },

    // ✅ FIX: rider add kiya
    role: {
      type: String,
      enum: ['customer', 'rider'],  // ❗ driver → rider
      required: [true, 'Role is required'],
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
    },

    message: {
      type: String,
      required: [true, 'Message is required'],
      minlength: [10, 'Message must be at least 10 characters'],
      trim: true,
    },
  },
  { timestamps: true }
);

export default model('Inquiry', inquirySchema);