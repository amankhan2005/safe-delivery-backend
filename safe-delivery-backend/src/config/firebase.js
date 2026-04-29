const admin = require('firebase-admin');

let firebaseApp;

const initializeFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY
          ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
          : undefined,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    console.log('Firebase Admin SDK initialized.');
  } catch (error) {
    console.error('Firebase initialization error:', error.message);
  }

  return firebaseApp;
};

const getMessaging = () => {
  initializeFirebase();
  return admin.messaging();
};

module.exports = { initializeFirebase, getMessaging };