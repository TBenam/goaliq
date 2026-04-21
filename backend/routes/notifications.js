/* ====================================================
   GoalIQ — Notifications Routes
   POST /api/notifications/subscribe   → save FCM token
   DELETE /api/notifications/unsubscribe → remove token
   POST /api/notifications/broadcast   → send to all (admin)
   POST /api/notifications/vip-alert   → VIP-only push (admin)
   ==================================================== */

import { Router } from 'express';
import { db, sendPushToTokens } from '../firebase/admin.js';
import admin from '../firebase/admin.js';
import { optionalAuth, requireAdmin } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ── POST /api/notifications/subscribe ────────────────
router.post('/subscribe', optionalAuth, async (req, res) => {
  const { token, platform = 'web' } = req.body;
  if (!token) return res.status(400).json({ error: 'Token FCM requis' });

  const uid = req.user?.uid || null;
  const isVip = uid ? await checkVip(uid) : false;

  try {
    await db.collection('fcm_tokens').doc(token).set({
      token,
      uid,
      is_vip: isVip,
      platform,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      last_seen: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Also update user document if authenticated
    if (uid) {
      await db.collection('users').doc(uid).update({
        fcm_tokens: admin.firestore.FieldValue.arrayUnion(token)
      });
    }

    logger.info(`[Notifs] Token enregistré: ${token.substring(0, 20)}... [uid:${uid || 'anon'}]`);
    res.json({ success: true, message: 'Notifications activées' });
  } catch (err) {
    logger.error('[Notifs/subscribe] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur enregistrement token' });
  }
});

// ── DELETE /api/notifications/unsubscribe ─────────────
router.delete('/unsubscribe', optionalAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requis' });

  try {
    await db.collection('fcm_tokens').doc(token).delete();
    if (req.user?.uid) {
      await db.collection('users').doc(req.user.uid).update({
        fcm_tokens: admin.firestore.FieldValue.arrayRemove(token)
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

// ── POST /api/notifications/broadcast ────────────────
// Send to ALL subscribers (free + VIP)
router.post('/broadcast', requireAdmin, async (req, res) => {
  const { title, body, url = '/', urgent = false } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title et body requis' });

  try {
    const snap = await db.collection('fcm_tokens').get();
    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);

    if (!tokens.length) return res.json({ success: true, sent: 0 });

    // FCM has 500-token batch limit
    const BATCH_SIZE = 500;
    let totalSent = 0;
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const result = await sendPushToTokens(batch, { title, body }, {
        url, urgent: String(urgent)
      });
      totalSent += result?.successCount || 0;
    }

    logger.info(`[Notifs] Broadcast envoyé à ${totalSent}/${tokens.length} abonnés`);
    res.json({ success: true, sent: totalSent, total: tokens.length });
  } catch (err) {
    logger.error('[Notifs/broadcast] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur envoi' });
  }
});

// ── POST /api/notifications/vip-alert ────────────────
// Send to VIP subscribers only — "Late Value" alerts
router.post('/vip-alert', requireAdmin, async (req, res) => {
  const { title, body, url = '/#pronos' } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title et body requis' });

  try {
    const snap = await db.collection('fcm_tokens')
      .where('is_vip', '==', true)
      .get();

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) return res.json({ success: true, sent: 0 });

    await sendPushToTokens(tokens, { title, body }, { url, urgent: 'true' });
    logger.info(`[Notifs] Alerte VIP envoyée: ${tokens.length} membres`);
    res.json({ success: true, sent: tokens.length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur envoi VIP' });
  }
});

async function checkVip(uid) {
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return false;
    const { is_vip, vip_expires_at } = doc.data();
    const expiry = vip_expires_at?.toDate?.();
    return is_vip && (!expiry || expiry > new Date());
  } catch { return false; }
}

export default router;
