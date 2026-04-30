import { Schema, model } from 'mongoose';

const promoCodeSchema = new Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
  },
  discount: {
    type: Number,
    required: true,
  },
  type: {
    type: String,
    enum: ['flat', 'percentage'],
    required: true,
  },
  expiresAt: { type: Date },
  usageLimit: { type: Number, default: 100 },
  usedCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
});

const pricingSchema = new Schema(
  {
    costPerMile: {
      type: Number,
      required: true,
      default: 1.5,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    promoCodes: [promoCodeSchema],
  },
  { timestamps: true }
);

export default model('Pricing', pricingSchema);