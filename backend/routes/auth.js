/* ====================================================
   GOLIAT — Auth Routes
   POST /api/auth/register   → create/sync user in Firestore
   POST /api/auth/activate-vip → activate VIP via code
   GET  /api/auth/me         → get user profile
   POST /api/admin/generate-codes → generate VIP codes (admin)
   ==================================================== */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, auth } from '../firebase/admin.js';
import admin from '../firebase/admin.js';
import { verifyToken, requireAdmin } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ── Plan durations in days ────────────────────────────
const PLAN_DURATIONS = {
  weekly: 7,
  monthly: 30,
  quarterly: 90
};

// ── POST /api/auth/register ───────────────────────────
// Called after Firebase client-side sign-in.
// Creates/updates the user document in Firestore.
router.post('/register', verifyToken, async (req, res) => {
  const { uid, email, phone_number } = req.user;
  try {
    const userRef = db.collection('users').doc(uid);
    const existing = await userRef.get();

    if (!existing.exists) {
      // New user — create document
      await userRef.set({
        uid,
        email: email || null,
        phone: phone_number || req.body.phone || null,
        is_vip: false,
        vip_expires_at: null,
        plan: null,
        streak: 1,
        last_visit: admin.firestore.FieldValue.serverTimestamp(),
        fcm_tokens: [],
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.info(`[Auth] Nouvel utilisateur: ${uid}`);
    } else {
      // Update last visit + streak
      const userData = existing.data();
      const lastVisit = userData.last_visit?.toDate?.() || new Date(0);
      const now = new Date();
      const diffDays = Math.floor((now - lastVisit) / 86400000);
      const newStreak = diffDays === 1 ? (userData.streak || 0) + 1 : diffDays === 0 ? userData.streak : 1;

      await userRef.update({
        last_visit: admin.firestore.FieldValue.serverTimestamp(),
        streak: newStreak
      });
    }

    const snap = await userRef.get();
    res.json({ success: true, user: sanitizeUser(snap.data()) });
  } catch (err) {
    logger.error('[Auth/register] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur enregistrement' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).get();
    if (!doc.exists) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const userData = doc.data();
    // Check if VIP has expired
    const vipExpiry = userData.vip_expires_at?.toDate?.();
    if (userData.is_vip && vipExpiry && vipExpiry < new Date()) {
      await doc.ref.update({ is_vip: false });
      userData.is_vip = false;
    }

    res.json({ user: sanitizeUser(userData) });
  } catch (err) {
    logger.error('[Auth/me] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /api/auth/activate-vip ──────────────────────
// User receives a code on WhatsApp after payment
// They enter it in the app → VIP activated
router.post('/activate-vip', verifyToken, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code requis' });

  try {
    // Find the code in Firestore
    const codeSnap = await db.collection('vip_codes')
      .where('code', '==', code.trim().toUpperCase())
      .where('used', '==', false)
      .limit(1)
      .get();

    if (codeSnap.empty) {
      return res.status(400).json({ error: 'Code invalide ou déjà utilisé', code: 'INVALID_CODE' });
    }

    const codeDoc = codeSnap.docs[0];
    const codeData = codeDoc.data();

    // Check code expiry
    const codeExpiry = codeData.expires_at?.toDate?.();
    if (codeExpiry && codeExpiry < new Date()) {
      return res.status(400).json({ error: 'Code expiré', code: 'EXPIRED_CODE' });
    }

    // Compute VIP expiry
    const days = PLAN_DURATIONS[codeData.plan] || 30;
    const vipExpiresAt = new Date(Date.now() + days * 86400000);

    // Batch: mark code as used + activate VIP
    const batch = db.batch();

    batch.update(codeDoc.ref, {
      used: true,
      used_by: req.user.uid,
      used_at: admin.firestore.FieldValue.serverTimestamp()
    });

    batch.update(db.collection('users').doc(req.user.uid), {
      is_vip: true,
      plan: codeData.plan,
      vip_expires_at: admin.firestore.Timestamp.fromDate(vipExpiresAt),
      vip_activated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    logger.info(`[Auth] VIP activé: ${req.user.uid} — Plan: ${codeData.plan} — Expire: ${vipExpiresAt.toLocaleDateString('fr')}`);

    res.json({
      success: true,
      message: `🎉 VIP activé ! Accès ${codeData.plan} jusqu'au ${vipExpiresAt.toLocaleDateString('fr', { day:'2-digit', month:'long', year:'numeric' })}`,
      vip_expires_at: vipExpiresAt.toISOString(),
      plan: codeData.plan
    });
  } catch (err) {
    logger.error('[Auth/activate-vip] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur activation' });
  }
});

// ── POST /api/admin/generate-codes ────────────────────
// Admin generates batch VIP codes (e.g., after payment)
router.post('/admin/generate-codes', requireAdmin, async (req, res) => {
  const { plan, count = 1 } = req.body;

  if (!PLAN_DURATIONS[plan]) {
    return res.status(400).json({ error: `Plan invalide. Options: ${Object.keys(PLAN_DURATIONS).join(', ')}` });
  }

  const maxCount = Math.min(parseInt(count), 100);
  const codes = [];
  const batch = db.batch();

  for (let i = 0; i < maxCount; i++) {
    const code = `GIQ-${uuidv4().substring(0, 8).toUpperCase()}`;
    const codeRef = db.collection('vip_codes').doc(code);
    const expiresAt = new Date(Date.now() + 7 * 86400000); // Code valid for 7 days

    batch.set(codeRef, {
      code,
      plan,
      used: false,
      used_by: null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      expires_at: admin.firestore.Timestamp.fromDate(expiresAt)
    });
    codes.push(code);
  }

  await batch.commit();
  logger.info(`[Admin] ${maxCount} codes VIP générés — Plan: ${plan}`);
  res.json({ success: true, codes, plan, count: codes.length });
});

function sanitizeUser(data) {
  return {
    uid: data.uid,
    email: data.email,
    is_vip: data.is_vip,
    plan: data.plan,
    vip_expires_at: data.vip_expires_at?.toDate?.()?.toISOString() || null,
    streak: data.streak,
    created_at: data.created_at?.toDate?.()?.toISOString() || null
  };
}

export default router;
