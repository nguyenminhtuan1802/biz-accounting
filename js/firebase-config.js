// Firebase web app config.
//
// These values are NOT secrets — they only tell the browser which Firebase
// project to talk to. Access is protected by Firebase Authentication and by the
// security rules in /firestore.rules (enforced on Google's servers).
//
// Paste the config from: Firebase console → Project settings → General →
// Your apps → Web app → "SDK setup and configuration" → Config.
// While this is null the app runs in local mode (data in this browser only).

export const firebaseConfig = null;
// export const firebaseConfig = {
//   apiKey: '...',
//   authDomain: '...firebaseapp.com',
//   projectId: '...',
//   storageBucket: '...',
//   messagingSenderId: '...',
//   appId: '...',
// };

// Login names typed on the sign-in screen. Firebase needs a real email shape,
// so "admin@1802" is stored in Firebase as "admin@1802.local".
// Keep these in sync with firestore.rules.
export const ADMIN_LOGINS = ['admin@1802'];

export function loginToEmail(login) {
  const l = String(login || '').trim().toLowerCase();
  return /@[^@]+\.[^@]+$/.test(l) ? l : `${l}.local`;
}

export const emailToLogin = (email) => String(email || '').replace(/\.local$/, '');
