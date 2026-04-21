/* ====================================================
   GoalIQ — Firebase Admin SDK Initialization
   Project: goliat-8bf4a
   Firestore + Auth + FCM (Cloud Messaging)
   ==================================================== */

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { logger } from '../utils/logger.js';

let db, auth, messaging;

function loadServiceAccount() {
  // Priority 1: JSON string in env var
  if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_SERVICE_ACCOUNT.length > 10) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      logger.warn('[Firebase] FIREBASE_SERVICE_ACCOUNT invalide, essai du fichier...');
    }
  }

  // Priority 2: Path to service account file
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      logger.error('[Firebase] Impossible de lire le service account:', err.message);
    }
  }

  logger.warn('[Firebase] ⚠️  Service account manquant. Téléchargez-le sur:');
  logger.warn('[Firebase]    https://console.firebase.google.com/project/goliat-8bf4a/settings/serviceaccounts/adminsdk');
  return null;
}

function initFirebase() {
  if (admin.apps.length > 0) {
    return; // Already initialized
  }

  const serviceAccount = loadServiceAccount();

  try {
    const initConfig = {
      projectId: process.env.FIREBASE_PROJECT_ID || 'goliat-8bf4a',
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://goliat-8bf4a-default-rtdb.firebaseio.com'
    };

    if (serviceAccount) {
      initConfig.credential = admin.credential.cert(serviceAccount);
    } else {
      // Fallback: Application Default Credentials (won't work locally without service account)
      logger.warn('[Firebase] Démarrage sans service account — fonctionnalités limitées');
      initConfig.credential = admin.credential.applicationDefault();
    }

    admin.initializeApp(initConfig);

    db = admin.firestore();
    auth = admin.auth();
    messaging = admin.messaging();

    // Firestore settings: timestamps in Dates, ignore undefined
    db.settings({ ignoreUndefinedProperties: true });

    logger.info('[Firebase] ✓ Admin SDK initialisé — Projet: goliat-8bf4a');
  } catch (err) {
    logger.error('[Firebase] Erreur initialisation:', err.message);
    // Don't throw — server starts but Firebase features are disabled
  }
}

// Initialize on import
initFirebase();


/* ── Firestore helpers ─────────────────────────────── */

/**
 * Upsert a Firestore document by a field value
 * @param {string} collection
 * @param {string} field  - field to match
 * @param {*}      value  - value to match
 * @param {object} data   - data to set/merge
 */
export async function upsertByField(collection, field, value, data) {
  const snapshot = await db.collection(collection)
    .where(field, '==', value)
    .limit(1)
    .get();

  if (snapshot.empty) {
    await db.collection(collection).add({
      ...data,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await snapshot.docs[0].ref.update({
      ...data,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

/**
 * Send FCM push notification to multiple tokens
 */
export async function sendPushToTokens(tokens, notification, data = {}) {
  if (!tokens?.length) return;

  const message = {
    notification: {
      title: notification.title,
      body: notification.body,
      imageUrl: notification.imageUrl
    },
    data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
    tokens,
    webpush: {
      notification: {
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        requireInteraction: data.urgent === 'true'
      },
      fcmOptions: { link: data.url || '/' }
    }
  };

  try {
    const response = await messaging.sendEachForMulticast(message);
    logger.info(`[FCM] Notifs envoyées: ${response.successCount}/${tokens.length}`);

    // Remove invalid tokens
    const invalidTokens = [];
    response.responses.forEach((resp, i) => {
      if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
        invalidTokens.push(tokens[i]);
      }
    });
    if (invalidTokens.length) {
      await cleanupInvalidTokens(invalidTokens);
    }

    return response;
  } catch (err) {
    logger.error('[FCM] Erreur envoi:', err.message);
  }
}

async function cleanupInvalidTokens(invalidTokens) {
  const batch = db.batch();
  for (const token of invalidTokens) {
    const snap = await db.collection('fcm_tokens').where('token', '==', token).get();
    snap.docs.forEach(doc => batch.delete(doc.ref));
  }
  await batch.commit();
  logger.info(`[FCM] ${invalidTokens.length} tokens invalides supprimés`);
}

export { db, auth, messaging };
export default admin;
