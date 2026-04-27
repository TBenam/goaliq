/* ====================================================
   GOLIAT — Auth Middleware
   Firebase ID Token verification + VIP status check
   ==================================================== */

import { auth, db } from '../firebase/admin.js';
import { logger } from '../utils/logger.js';
import { getActiveVipCodeEntry, getRequestVipCode } from '../utils/vipAccess.js';

/**
 * Verify Firebase ID Token from Authorization header
 * Sets req.user = { uid, email, ...decodedToken }
 */
export async function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant', code: 'MISSING_TOKEN' });
  }

  const token = header.split('Bearer ')[1];
  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn('[Auth] Token invalide:', err.code);
    return res.status(401).json({ error: 'Token invalide ou expiré', code: 'INVALID_TOKEN' });
  }
}

/**
 * Verify VIP status from Firestore user document
 * Must be used AFTER verifyToken
 * Sets req.userDoc = full user document from Firestore
 */
export async function verifyVIP(req, res, next) {
  // First verify the token
  await verifyToken(req, res, async () => {
    if (!req.user) return; // Already sent error

    try {
      const localVipEntry = getActiveVipCodeEntry(getRequestVipCode(req));
      const userDoc = await db.collection('users').doc(req.user.uid).get();

      if (!userDoc.exists) {
        if (localVipEntry) {
          req.userDoc = {
            uid: req.user.uid,
            is_vip: true,
            plan: localVipEntry.plan,
            vip_code: localVipEntry.code,
            vip_expires_at: localVipEntry.expires_at ? new Date(localVipEntry.expires_at) : null
          };
          return next();
        }
        return res.status(403).json({ error: 'Utilisateur introuvable', code: 'USER_NOT_FOUND' });
      }

      const userData = userDoc.data();

      // Check VIP expiry
      const now = new Date();
      const vipExpiry = userData.vip_expires_at?.toDate?.();

      if ((!userData.is_vip || (vipExpiry && vipExpiry < now)) && !localVipEntry) {
        // Auto-deactivate expired VIP
        if (userData.is_vip && vipExpiry) {
          await userDoc.ref.update({ is_vip: false });
        }
        return res.status(403).json({
          error: 'Accès VIP requis',
          code: 'VIP_REQUIRED',
          message: 'Passez VIP pour accéder à ce contenu'
        });
      }

      req.userDoc = localVipEntry
        ? {
            ...userData,
            is_vip: true,
            plan: localVipEntry.plan,
            vip_code: localVipEntry.code,
            vip_expires_at: localVipEntry.expires_at ? new Date(localVipEntry.expires_at) : null
          }
        : userData;
      next();
    } catch (err) {
      logger.error('[Auth] Erreur vérification VIP:', err.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });
}

/**
 * Optional auth — doesn't reject unauthenticated requests
 * Sets req.user if token is valid, otherwise req.user = null
 */
export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  try {
    const token = header.split('Bearer ')[1];
    req.user = await auth.verifyIdToken(token);
  } catch {
    req.user = null;
  }
  next();
}

/**
 * Admin-only routes — requires ADMIN_SECRET_KEY header
 */
export function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Accès admin requis' });
  }
  next();
}
