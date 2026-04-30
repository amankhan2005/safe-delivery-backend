const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: ['customer', 'driver'],
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

module.exports = mongoose.model('Inquiry', inquirySchema);