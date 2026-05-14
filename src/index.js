import ‘dotenv/config’;
import express, { json, urlencoded } from ‘express’;
import { createServer } from ‘http’;
import helmet from ‘helmet’;
import cors from ‘cors’;
import morgan from ‘morgan’;
import rateLimit from ‘express-rate-limit’;
import mongoose from ‘mongoose’;
import compression from ‘compression’;

import connectDB         from ‘./config/db.js’;
import { initializeFirebase } from ‘./config/firebase.js’;
import { initSocket }    from ‘./services/socketService.js’;
import errorHandler      from ‘./middleware/errorHandler.js’;

import authRoutes         from ‘./routes/auth.js’;
import riderRoutes        from ‘./routes/riders.js’;
import orderRoutes        from ‘./routes/orders.js’;
import adminRoutes        from ‘./routes/admin.js’;
import notificationRoutes from ‘./routes/notifications.js’;
import inquiryRoutes      from ‘./routes/inquiryRoutes.js’;
import locationRoutes     from ‘./routes/location.js’;

const app        = express();
const httpServer = createServer(app);
const isProd     = process.env.NODE_ENV === ‘production’;

app.set(‘trust proxy’, 1);

// ─── SECURITY ────────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: ‘cross-origin’ } }));
app.use(cors({ origin: ‘*’, methods: [‘GET’,‘POST’,‘PUT’,‘PATCH’,‘DELETE’,‘OPTIONS’] }));

// ─── ROUTE CLASSIFICATION HELPER ─────────────────────────────────────────────
// IMPORTANT: Only skip body parsers / compression for TRUE multipart/file-upload
// routes. kyc/step1 and kyc/step3 send plain JSON — they MUST go through
// express.json(). Only kyc/step2 uploads files.
//
// BUG THAT WAS HERE: the old check was `req.url.includes('/kyc')` which matched
// ALL three KYC steps. That caused express.json() to be skipped for step1 and
// step3, leaving req.body as undefined and crashing the controller with:
//   “Cannot destructure property ‘dob’ of ‘req.body’ as it is undefined”
const isUploadRoute = (req) => (
req.url.includes(’/photo’)       ||
req.url.includes(’/kyc/step2’)   ||   // ← FIXED: only step2 uploads files
req.url.includes(’/selfie’)      ||
req.url.includes(’/profile/photo’)
);

// ─── COMPRESSION ─────────────────────────────────────────────────────────────
// CRITICAL: Never compress upload routes.
// Compressing multipart/form-data corrupts multer’s boundary parsing,
// silently drops the file, and causes ERR_NETWORK on Android.
app.use((req, res, next) => {
if (isUploadRoute(req)) return next();
return compression({
level:     4,
threshold: 2048,
filter: (req, res) => {
if ((req.headers.accept || ‘’).includes(‘text/event-stream’)) return false;
return compression.filter(req, res);
},
})(req, res, next);
});

// ─── CONNECTION HEADER ────────────────────────────────────────────────────────
// Force Connection: close on upload routes so Android OkHttp never reuses
// a potentially dead keep-alive socket from its pool for uploads.
app.use((req, res, next) => {
if (isUploadRoute(req)) res.set(‘Connection’, ‘close’);
next();
});

// ─── LOGGING ─────────────────────────────────────────────────────────────────
app.use(morgan(isProd ? ‘combined’ : ‘dev’, {
skip: isProd
? (req) =>
req.url.includes(’/riders/orders’)       ||
req.url.includes(’/riders/dashboard’)    ||
req.url.includes(’/riders/update-location’) ||
req.url === ‘/health’
: undefined,
}));

// ─── BODY PARSERS ────────────────────────────────────────────────────────────
// CRITICAL: Skip body parsers on upload routes ONLY.
// If json()/urlencoded() runs before multer on a multipart request,
// it consumes the raw stream — multer gets nothing and the file is lost.
// JSON routes (kyc/step1, kyc/step3, etc.) MUST NOT be skipped.
app.use((req, res, next) => {
if (isUploadRoute(req)) return next();
return json({ limit: ‘10mb’ })(req, res, (err) => {
if (err) return next(err);
urlencoded({ extended: true, limit: ‘10mb’ })(req, res, next);
});
});

// ─── REQUEST TIMEOUT ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
const timeoutMs = isUploadRoute(req) ? 180_000 : 25_000;
const timer = setTimeout(() => {
if (!res.headersSent) {
console.warn(`[Timeout] ${req.method} ${req.url}`);
res.status(504).json({ success: false, error: ‘Request timed out. Please try again.’ });
}
}, timeoutMs);
res.on(‘finish’, () => clearTimeout(timer));
res.on(‘close’,  () => clearTimeout(timer));
next();
});

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
// In development: very high limits so local testing is never blocked.
// In production: strict limits to protect Render free tier.
const globalLimiter = rateLimit({
windowMs:        15 * 60 * 1000,
max:             isProd ? 3000 : 100_000,
standardHeaders: true,
legacyHeaders:   false,
skip:            (req) => req.path === ‘/health’ || req.path === ‘/’,
message:         { success: false, error: ‘Too many requests. Please slow down.’ },
});

const pollLimiter = rateLimit({
windowMs:        60 * 1000,
max:             isProd ? 20 : 100_000,
standardHeaders: true,
legacyHeaders:   false,
keyGenerator:    (req) => req.headers.authorization?.split(’ ’)[1] || req.ip,
message:         { success: false, error: ‘Too many status requests.’ },
});

const otpLimiter = rateLimit({
windowMs: 5 * 60 * 1000,
max:      isProd ? 5 : 100,
message:  { success: false, error: ‘Too many OTP requests. Please wait 5 minutes.’ },
});

app.use(globalLimiter);
app.use(’/api/riders/orders’,    pollLimiter);
app.use(’/api/riders/dashboard’, pollLimiter);

[
‘/api/auth/rider-resend-otp’,
‘/api/auth/rider-forgot-password’,
‘/api/auth/rider-resend-forgot-otp’,
‘/api/auth/send-login-otp’,
].forEach((p) => app.use(p, otpLimiter));

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get(’/health’, (req, res) => {
res.json({
success: true,
message: ‘Safe Delivery API is running’,
env:     process.env.NODE_ENV,
db:      mongoose.connection.readyState,
uptime:  Math.floor(process.uptime()),
ts:      new Date().toISOString(),
});
});

app.get(’/’, (req, res) =>
res.json({ success: true, message: ‘Safe Delivery API’ })
);

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use(’/api/auth’,          authRoutes);
app.use(’/api/riders’,        riderRoutes);
app.use(’/api/orders’,        orderRoutes);
app.use(’/api/admin’,         adminRoutes);
app.use(’/api/notifications’, notificationRoutes);
app.use(’/api/inquiry’,       inquiryRoutes);
app.use(’/api/location’,      locationRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
res.status(404).json({
success: false,
error:   `Route ${req.method} ${req.originalUrl} not found.`,
});
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── PROCESS SAFETY ──────────────────────────────────────────────────────────
process.on(‘unhandledRejection’, (reason) => {
console.error(’[UnhandledRejection]’,
reason instanceof Error ? reason.message : reason
);
});

process.on(‘uncaughtException’, (error) => {
console.error(’[UncaughtException]’, error.message, error.stack);
process.exit(1);
});

process.on(‘SIGTERM’, () => {
console.log(’[SIGTERM] Graceful shutdown…’);
httpServer.close(() => {
mongoose.connection.close(false, () => {
console.log(’[SIGTERM] Server closed.’);
process.exit(0);
});
});
setTimeout(() => process.exit(1), 10000);
});

// ─── START ────────────────────────────────────────────────────────────────────
const startServer = async () => {
try {
await connectDB();
initializeFirebase();
initSocket(httpServer);

```
const PORT = parseInt(process.env.PORT || '5000', 10);

httpServer.listen(PORT, '0.0.0.0', () => {
  // keepAliveTimeout must exceed Render's HAProxy idle timeout (65s).
  // headersTimeout must be slightly above keepAliveTimeout.
  httpServer.keepAliveTimeout = 120_000;
  httpServer.headersTimeout   = 121_000;

  console.log(`\n🚀 Safe Ride Delivery API is running on port ${PORT}`);
  console.log(`📍 Mode: ${process.env.NODE_ENV}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health\n`);
});
```

} catch (error) {
console.error(‘Server start failed:’, error.message);
process.exit(1);
}
};

startServer();
export default app;