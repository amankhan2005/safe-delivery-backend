import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      index:    true,
      // works for both riders and customers — just store their _id
    },
    title: {
      type:     String,
      required: true,
      trim:     true,
    },
    message: {
      type:  String,
      trim:  true,
      default: '',
    },
    data: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },
    read: {
      type:    Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Auto-delete notifications older than 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;