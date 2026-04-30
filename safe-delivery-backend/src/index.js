import dotenv from 'dotenv';
dotenv.config();

import express, { json, urlencoded } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';

import connectDB from './config/db.js';
import { initializeFirebase } from './config/firebase.js';
import errorHandler from './middleware/errorHandler.js';

import authRoutes from './routes/auth.js';
import riderRoutes from './routes/riders.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import inquiryRoutes from './routes/inquiryRoutes.js';

const app = express();

// ─── SECURITY & MIDDLEWARE ─────────────────────────

app.use(helmet());

app.use(cors({
  origin: '*',  
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

// ─── RATE LIMIT ─────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
});

app.use(globalLimiter);

app.use('/api/auth/send-login-otp', otpLimiter);
app.use('/api/auth/resend-otp', otpLimiter);
app.use('/api/auth/resend-login-otp', otpLimiter);
app.use('/api/auth/forgot-password', otpLimiter);
app.use('/api/auth/resend-forgot-otp', otpLimiter);
app.use('/api/auth/rider-resend-otp', otpLimiter);
app.use('/api/auth/rider-send-login-otp', otpLimiter);
app.use('/api/auth/rider-resend-login-otp', otpLimiter);
app.use('/api/auth/rider-forgot-password', otpLimiter);
app.use('/api/auth/rider-resend-forgot-otp', otpLimiter);

// ─── HEALTH CHECK ─────────────────────────

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Safe Delivery API is running',
    env: process.env.NODE_ENV,
    dbState: mongoose.connection.readyState, // 1 = connected
  });
});

// ─── ROUTES ─────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inquiry', inquiryRoutes);

// ─── 404 ─────────────────────────

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// ─── ERROR HANDLER ─────────────────────────

app.use(errorHandler);

// ─── START SERVER (IMPORTANT FIX) ─────────────────────────

const startServer = async () => {
  try {
    await connectDB();        // ✅ DB connect first
    initializeFirebase();     // ✅ Firebase init

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`\n🚀 Safe Delivery API running on port ${PORT}`);
      console.log(`🌐 http://localhost:${PORT}`);
      console.log(`💚 Health: /health\n`);
    });

  } catch (error) {
    console.error('❌ Server start failed:', error.message);
    process.exit(1);
  }
};

startServer();

export default app;