import { Schema, model } from 'mongoose';

const promoCodeSchema = new Schema({
  code:         { type: String, required: true, uppercase: true, trim: true },
  discount:     { type: Number, required: true },
  type:         { type: String, enum: ['flat', 'percentage'], required: true },
  expiresAt:    { type: Date },
  usageLimit:   { type: Number, default: 100 },
  usedCount:    { type: Number, default: 0 },
  isActive:     { type: Boolean, default: true },
  userId:       { type: Schema.Types.ObjectId, ref: 'User', default: null },
  minOrderFare: { type: Number, default: 0 }, // minimum fare required to use this promo
});

const pricingSchema = new Schema(
  {
    costPerMile:     { type: Number, required: true, default: 1.5 },
    baseFare:        { type: Number, default: 0 },
    minFare:         { type: Number, default: 2.0 },
    surgeMultiplier: { type: Number, default: 1.0 },
    surgeActive:     { type: Boolean, default: false },
    currency:        { type: String, default: 'USD' },
    updatedBy:       { type: Schema.Types.ObjectId, ref: 'User' },
    promoCodes:      [promoCodeSchema],
  },
  { timestamps: true }
);

export default model('Pricing', pricingSchema);