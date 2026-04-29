 require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const { initializeFirebase } = require('./config/firebase');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const riderRoutes = require('./routes/riders');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');

// ─── Init ─────────────────────────────────────────────────────────────────────
connectDB();
initializeFirebase();

const app = express();

// ─── Security & Logging ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate Limiters ───────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many OTP requests. Please wait before trying again.' },
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

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Safe Delivery API is running.', env: process.env.NODE_ENV });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.originalUrl} not found.` });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Safe Delivery API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;