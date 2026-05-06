import 'dotenv/config';

import express, { json, urlencoded } from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';

import connectDB from './config/db.js';
import { initializeFirebase } from './config/firebase.js';
import { initSocket } from './services/socketService.js';
import errorHandler from './middleware/errorHandler.js';

import authRoutes from './routes/auth.js';
import riderRoutes from './routes/riders.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import inquiryRoutes from './routes/inquiryRoutes.js';
import locationRoutes from './routes/location.js';

import { getAllowedCountries, getDefaultCountry, COUNTRY_CONFIG } from './config/countries.js';

const app = express();
const httpServer = createServer(app);

// ─── SECURITY & MIDDLEWARE ────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

// ─── RATE LIMIT ───────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 300 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 5 });

app.use(globalLimiter);

const otpPaths = [
  '/api/auth/send-login-otp',
  '/api/auth/resend-otp',
  '/api/auth/resend-login-otp',
  '/api/auth/forgot-password',
  '/api/auth/resend-forgot-otp',
  '/api/auth/rider-resend-otp',
  '/api/auth/rider-send-login-otp',
  '/api/auth/rider-resend-login-otp',
  '/api/auth/rider-forgot-password',
  '/api/auth/rider-resend-forgot-otp',
];
otpPaths.forEach((p) => app.use(p, otpLimiter));

// ─── HEALTH CHECK — used by frontend ping + Render uptime check ───────────────

app.get('/health', (req, res) => {
  res.json({
    success:          true,
    message:          'Safe Delivery API is running',
    env:              process.env.NODE_ENV,
    dbState:          mongoose.connection.readyState,
    uptime:           Math.floor(process.uptime()),
    allowedCountries: getAllowedCountries(),
    defaultCountry:   getDefaultCountry(),
  });
});

app.get('/', (req, res) => {
  res.send('🚀 Safe Delivery API Running');
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.use('/api/auth',          authRoutes);
app.use('/api/riders',        riderRoutes);
app.use('/api/orders',        orderRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/inquiry',       inquiryRoutes);
app.use('/api/location',      locationRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────

app.use(errorHandler);

// ─── START SERVER ─────────────────────────────────────────────────────────────

const startServer = async () => {
  try {
    await connectDB();
    initializeFirebase();
    initSocket(httpServer);

    const PORT = process.env.PORT || 5000;

    httpServer.listen(PORT, () => {
      // FIX: increase timeouts so Render doesn't drop long-running requests
      // Frontend retry logic relies on these being >= 30s
      httpServer.keepAliveTimeout = 120000;   // 2 min
      httpServer.headersTimeout   = 121000;   // must be > keepAliveTimeout

      console.log(`\n🚀 Safe Delivery API running on port ${PORT}`);
      console.log(`🌐 http://localhost:${PORT}`);
      console.log(`💚 Health: /health`);

      const allowed = getAllowedCountries();
      allowed.forEach((key) => {
        const c = COUNTRY_CONFIG[key];
        console.log(`🌍 Country: ${c.name} [${c.environment.toUpperCase()}]`);
      });
      console.log('');
    });
  } catch (error) {
    console.error('❌ Server start failed:', error.message);
    process.exit(1);
  }
};

startServer();

export default app;