import mongoose from 'mongoose';

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  try {
    mongoose.set('strictQuery', true);

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000, // how long to find a server
      socketTimeoutMS:          45000, // how long a query can run
      connectTimeoutMS:         10000, // initial TCP connection
      maxPoolSize:              10,    // max concurrent connections
    });

    isConnected = true;
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    console.log('🔄 Retrying in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};

mongoose.connection.on('connected',    () => console.log('🟢 MongoDB connected'));
mongoose.connection.on('disconnected', () => { isConnected = false; console.warn('🟡 MongoDB disconnected. Reconnecting...'); });
mongoose.connection.on('reconnected',  () => { isConnected = true;  console.log('🔵 MongoDB reconnected'); });
mongoose.connection.on('error',        (err) => console.error('🔴 MongoDB error:', err.message));

export default connectDB;