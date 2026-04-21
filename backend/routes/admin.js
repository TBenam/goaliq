/* ====================================================
   GoalIQ — Admin Route
   Activation des codes VIP après paiement WhatsApp

   USAGE:
   POST /api/admin/activate
     Body: { code: "GIQ-A3F7K2", plan: "monthly", secret: "VOTRE_SECRET_ADMIN" }

   GET /api/admin/check/:code
     Appelé par le frontend après paiement
   ==================================================== */

import { Router } from 'express';
import { cacheRead, cacheWrite } from '../cache/manager.js';
import { logger } from '../utils/logger.js';

const router = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'goaliq-admin-2026';

// Plans configuration
const PLAN_DURATIONS = {
  weekly:    7  * 24 * 3600 * 1000,  // 7 jours
  monthly:   30 * 24 * 3600 * 1000,  // 30 jours
  quarterly: 90 * 24 * 3600 * 1000,  // 90 jours
  bonus:     0                         // one-shot, pas d'expiration
};

// ── Helper: load/save activation codes ──────────────
function loadCodes() {
  const cached = cacheRead('vip_codes', 999999); // Never expire
  return cached?.data || {};
}
function saveCodes(codes) {
  cacheWrite('vip_codes', codes);
}

// ── GET /api/admin/check/:code ───────────────────────
// Appelé par le frontend toutes les 5s après paiement
// Retourne le statut VIP du code
router.get('/check/:code', (req, res) => {
  const code = req.params.code?.toUpperCase().trim();
  if (!code) return res.status(400).json({ active: false, error: 'Code manquant' });

  const codes = loadCodes();
  const entry = codes[code];

  if (!entry) {
    return res.json({ active: false, status: 'pending', message: 'Code non encore activé' });
  }

  // Check expiration
  const now = Date.now();
  if (entry.expires_at && entry.expires_at < now) {
    return res.json({ active: false, status: 'expired', message: 'Abonnement expiré', expired_at: entry.expires_at });
  }

  // Active!
  return res.json({
    active: true,
    status: 'active',
    plan: entry.plan,
    expires_at: entry.expires_at,
    activated_at: entry.activated_at,
    message: `Accès VIP ${entry.plan} actif ✅`
  });
});

// ── POST /api/admin/activate ─────────────────────────
// Appelé par l'admin (toi) après confirmation du paiement
// Nécessite le secret admin
router.post('/activate', (req, res) => {
  const { code, plan, secret, phone } = req.body || {};

  // Auth check
  if (secret !== ADMIN_SECRET) {
    logger.warn(`[Admin] Tentative d'activation non autorisée`);
    return res.status(403).json({ error: 'Secret invalide' });
  }

  if (!code || !plan) {
    return res.status(400).json({ error: 'code et plan requis' });
  }

  const cleanCode = code.toUpperCase().trim();
  if (!PLAN_DURATIONS.hasOwnProperty(plan)) {
    return res.status(400).json({ error: `Plan invalide. Choix: ${Object.keys(PLAN_DURATIONS).join(', ')}` });
  }

  const codes = loadCodes();
  const now = Date.now();
  const duration = PLAN_DURATIONS[plan];
  const expires_at = duration > 0 ? now + duration : null;

  codes[cleanCode] = {
    code: cleanCode,
    plan,
    phone: phone || null,
    activated_at: now,
    expires_at,
    activated_by: 'admin'
  };

  saveCodes(codes);

  const expDate = expires_at ? new Date(expires_at).toLocaleDateString('fr-FR') : 'illimité';
  logger.info(`[Admin] ✅ Code ${cleanCode} activé — Plan: ${plan} — Expiration: ${expDate}${phone ? ` — Tél: ${phone}` : ''}`);

  return res.json({
    success: true,
    code: cleanCode,
    plan,
    expires_at,
    expires_label: expDate,
    message: `Code ${cleanCode} activé avec succès (${plan}, expire le ${expDate})`
  });
});

// ── POST /api/admin/revoke ────────────────────────────
// Révoquer un accès VIP (en cas de litige ou fraude)
router.post('/revoke', (req, res) => {
  const { code, secret } = req.body || {};
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Secret invalide' });

  const codes = loadCodes();
  if (!codes[code?.toUpperCase()]) return res.status(404).json({ error: 'Code introuvable' });

  delete codes[code.toUpperCase()];
  saveCodes(codes);
  logger.info(`[Admin] Code ${code} révoqué`);
  return res.json({ success: true, message: `Code ${code} révoqué` });
});

// ── GET /api/admin/list ───────────────────────────────
// Voir tous les codes actifs (pour toi uniquement)
router.get('/list', (req, res) => {
  const secret = req.query.secret;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Secret invalide' });

  const codes = loadCodes();
  const now = Date.now();

  const list = Object.values(codes).map(c => ({
    ...c,
    is_active: !c.expires_at || c.expires_at > now,
    expires_label: c.expires_at ? new Date(c.expires_at).toLocaleDateString('fr-FR') : 'illimité'
  }));

  return res.json({
    total: list.length,
    active: list.filter(c => c.is_active).length,
    expired: list.filter(c => !c.is_active).length,
    codes: list.sort((a, b) => b.activated_at - a.activated_at)
  });
});

// ── GET /api/admin/panel ─────────────────────────────
// Mini panel HTML d'activation (interface web simple)
router.get('/panel', (req, res) => {
  const secret = req.query.secret || '';
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GoalIQ Admin — Activation VIP</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; padding: 24px 16px; }
    h1 { font-size: 1.4rem; font-weight: 900; margin-bottom: 8px; color: #10b981; }
    .sub { color: #6b7280; font-size: 0.85rem; margin-bottom: 32px; }
    .card { background: #1a1a1a; border-radius: 16px; padding: 24px; margin-bottom: 20px; border: 1px solid #2a2a2a; }
    h2 { font-size: 1rem; font-weight: 800; margin-bottom: 16px; }
    label { display: block; font-size: 0.75rem; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    input, select { width: 100%; background: #0a0a0a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 12px; color: white; font-size: 0.95rem; margin-bottom: 14px; outline: none; }
    input:focus, select:focus { border-color: #10b981; }
    button { width: 100%; background: #10b981; color: #000; font-weight: 800; border: none; border-radius: 10px; padding: 14px; font-size: 1rem; cursor: pointer; margin-bottom: 12px; }
    button:hover { background: #059669; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-secondary { background: #1a1a1a; color: #9ca3af; border: 1px solid #2a2a2a; }
    #result { background: #0a1f15; border: 1px solid #10b981; border-radius: 10px; padding: 14px; font-size: 0.85rem; line-height: 1.6; white-space: pre-wrap; display: none; }
    #result.error { background: #1f0a0a; border-color: #ef4444; }
    .badge { display: inline-block; background: #10b981; color: #000; font-size: 0.65rem; font-weight: 800; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; margin-left: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th { text-align: left; color: #6b7280; font-size: 0.7rem; text-transform: uppercase; padding: 8px 4px; border-bottom: 1px solid #2a2a2a; }
    td { padding: 10px 4px; border-bottom: 1px solid #1a1a1a; }
    .active { color: #10b981; font-weight: 700; }
    .expired { color: #ef4444; }
  </style>
</head>
<body>
  <h1>⚡ GoalIQ Admin</h1>
  <p class="sub">Panel d'activation VIP — Réservé à l'administrateur</p>

  <!-- Activation -->
  <div class="card">
    <h2>✅ Activer un code VIP</h2>
    <label>Secret Admin</label>
    <input type="password" id="secret" placeholder="Votre secret admin" value="${secret}">
    <label>Code client (ex: GIQ-A3F7K2)</label>
    <input type="text" id="code" placeholder="GIQ-XXXXXX" style="text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">
    <label>Plan</label>
    <select id="plan">
      <option value="weekly">Hebdomadaire — 7 jours (3 500 FCFA)</option>
      <option value="monthly" selected>Mensuel — 30 jours (10 000 FCFA)</option>
      <option value="quarterly">Trimestriel — 90 jours (25 000 FCFA)</option>
      <option value="bonus">Bonus Flash — one-shot (1 000 FCFA)</option>
    </select>
    <label>Numéro WhatsApp client (optionnel)</label>
    <input type="tel" id="phone" placeholder="+237 6XX XX XX XX">
    <button onclick="activate()">ACTIVER L'ACCÈS VIP</button>
    <div id="result"></div>
  </div>

  <!-- Liste codes -->
  <div class="card">
    <h2>📋 Codes actifs <span id="count-badge" class="badge">—</span></h2>
    <button class="btn-secondary" onclick="listCodes()" style="margin-bottom:16px;">Charger la liste</button>
    <div id="codes-list"></div>
  </div>

  <script>
    async function activate() {
      const r = document.getElementById('result');
      r.style.display = 'block';
      r.className = '';
      r.textContent = 'Activation en cours...';
      try {
        const res = await fetch('/api/admin/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: document.getElementById('secret').value,
            code: document.getElementById('code').value.toUpperCase(),
            plan: document.getElementById('plan').value,
            phone: document.getElementById('phone').value
          })
        });
        const data = await res.json();
        r.className = data.success ? '' : 'error';
        r.textContent = data.success
          ? '✅ ' + data.message
          : '❌ Erreur: ' + (data.error || JSON.stringify(data));
        if (data.success) listCodes();
      } catch(e) {
        r.className = 'error';
        r.textContent = '❌ Erreur réseau: ' + e.message;
      }
    }

    async function listCodes() {
      const secret = document.getElementById('secret').value;
      const res = await fetch('/api/admin/list?secret=' + secret);
      const data = await res.json();
      document.getElementById('count-badge').textContent = (data.active || 0) + ' actifs';
      const list = document.getElementById('codes-list');
      if (!data.codes?.length) { list.innerHTML = '<p style="color:#6b7280;font-size:0.8rem;">Aucun code</p>'; return; }
      list.innerHTML = '<table><thead><tr><th>Code</th><th>Plan</th><th>Expiration</th><th>Statut</th></tr></thead><tbody>' +
        data.codes.map(c => '<tr>' +
          '<td style="font-family:monospace;font-weight:700;">' + c.code + '</td>' +
          '<td>' + c.plan + '</td>' +
          '<td>' + (c.expires_label || '∞') + '</td>' +
          '<td class="' + (c.is_active ? 'active' : 'expired') + '">' + (c.is_active ? '✓ Actif' : '✗ Expiré') + '</td>' +
        '</tr>').join('') + '</tbody></table>';
    }

    // Auto-charger si secret en URL
    if ('${secret}') setTimeout(listCodes, 500);
  </script>
</body>
</html>`);
});

export default router;
