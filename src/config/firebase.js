import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

let firebaseApp;

export const initializeFirebase = () => {
  if (firebaseApp) return firebaseApp;

  const projectId   = (process.env.FIREBASE_PROJECT_ID   || '').replace(/[",\s]/g, '');
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').replace(/[",\s]/g, '');
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY    || '';

  // Strip surrounding quotes if present
  privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error('[Firebase] Missing credentials — check .env FIREBASE_* vars');
    return null;
  }

  try {
    if (admin.apps.length > 0) {
      firebaseApp = admin.apps[0];
    } else {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({ projectId, privateKey, clientEmail }),
      });
    }
    console.log('[Firebase] Admin SDK initialized. Project:', projectId);
  } catch (error) {
    console.error('[Firebase] Initialization error:', error.message);
  }

  return firebaseApp;
};

export const getFirebaseAdmin = () => {
  initializeFirebase();
  return admin;
};

export const getMessaging = () => {
  initializeFirebase();
  return admin.messaging();
};