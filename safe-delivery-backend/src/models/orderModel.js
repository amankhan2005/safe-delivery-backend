const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Rider',
      default: null,
    },
    pickup: {
      address: { type: String, required: true },
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      contactName: { type: String, required: true },
      contactPhone: { type: String, required: true },
    },
    drop: {
      address: { type: String, required: true },
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      contactName: { type: String, required: true },
      contactPhone: { type: String, required: true },
    },
    parcelWeight: {
      type: String,
      enum: ['<1lb', '1-5lb', '5-10lb', '>10lb'],
      required: true,
    },
    distanceMiles: { type: Number, required: true },
    fare: { type: Number, required: true },
    promoCode: { type: String, default: null },
    promoDiscount: { type: Number, default: 0 },
    paymentMethod: { type: String, default: 'cash' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'collected'],
      default: 'pending',
    },
    status: {
      type: String,
      enum: ['searching', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled'],
      default: 'searching',
    },
    deliveryOTP: {
      type: String,
      required: true,
    },
    otpVerified: { type: Boolean, default: false },
    otpVerifiedAt: { type: Date, default: null },
    pickupPhoto: {
      url: { type: String },
      publicId: { type: String },
    },
    dropPhoto: {
      url: { type: String },
      publicId: { type: String },
    },
    pickupPhotoAt: { type: Date },
    dropPhotoAt: { type: Date },
    riderAssignedAt: { type: Date },
    pickedUpAt: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String },
    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);