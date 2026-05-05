import { Schema, model } from 'mongoose';

const otpSchema = new Schema(
  {
    identifier: { type: String, required: true, trim: true },
    otp:        { type: String, required: true },
    type: {
      type: String,
      enum: ['phone', 'email', 'login', 'reset', 'signup_email'],
      required: true,
    },
    attempts:  { type: Number, default: 0 },
    verified:  { type: Boolean, default: false },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

otpSchema.index({ identifier: 1, type: 1 });

export default model('OTP', otpSchema);