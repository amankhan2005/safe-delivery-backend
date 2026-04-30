import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    mongoose.set('strictQuery', true);

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);

    // retry after 5 sec instead of exit
    setTimeout(connectDB, 5000);
  }
};

// events
mongoose.connection.on('connected', () => {
  console.log('🟢 MongoDB connected');
});

mongoose.connection.on('disconnected', () => {
  console.warn('🟡 MongoDB disconnected. Reconnecting...');
});

mongoose.connection.on('reconnected', () => {
  console.log('🔵 MongoDB reconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('🔴 MongoDB error:', err.message);
});

export default connectDB;