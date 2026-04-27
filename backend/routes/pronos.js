/* ====================================================
   GOLIAT — Pronos Routes (v2)
   Architecture cache-first:
   1. Lit depuis cache/data/pronos.json (instant)
   2. Firestore en fallback si cache absent
   3. Zéro appel API externe par requête client
   ==================================================== */

import { Router } from 'express';
import { cacheGet, getCacheInfo } from '../cache/manager.js';
import { verifyVIP, optionalAuth } from '../middleware/auth.js';
import { getRequestVipCode, hasActiveVipCode } from '../utils/vipAccess.js';
import { logger } from '../utils/logger.js';

const router = Router();
const DEFAULT_PRONOS_MAX_AGE_HOURS = 12;

function getPronosMaxAgeHours() {
  const parsed = Number.parseInt(process.env.PRONOS_MAX_AGE_HOURS || `${DEFAULT_PRONOS_MAX_AGE_HOURS}`, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 48
    ? parsed
    : DEFAULT_PRONOS_MAX_AGE_HOURS;
}

// ── In-memory cache (short TTL, protège même le filesystem) ──
const memCache = new Map();
function memGet(key) {
  const e = memCache.get(key);
  return (e && Date.now() < e.exp) ? e.val : null;
}
function memSet(key, val, ttlS = 120) {
  memCache.set(key, { val, exp: Date.now() + ttlS * 1000 });
}

// ── Read pronos from local JSON cache ─────────────────
function getPronoCache() {
  const cached = cacheGet('pronos', getPronosMaxAgeHours());
  if (!cached || cached.isStale) {
    return {
      data: [],
      isStale: cached?.isStale ?? true,
      generatedAt: cached?.generatedAt || null,
      count: cached?.count || 0
    };
  }
  return cached;
}

function getPronos() {
  return getPronoCache().data || [];
}

// ── Format a prono for API response ──────────────────
function formatProno(p, includeVipAnalysis = false) {
  const base = {
    id: p.fixture_id,
    fixture_id: p.fixture_id,
    match: p.match,
    home_team: p.home_team,
    away_team: p.away_team,
    home_team_logo: p.home_team_logo,
    away_team_logo: p.away_team_logo,
    competition: p.competition,
    league_flag: p.league_flag,
    kickoff: p.kickoff,
    heure: p.heure,
    venue: p.venue,
    prono: p.prono || p.prono_principal,
    cote: p.cote || p.cote_estimee,
    fiabilite: p.fiabilite,
    categorie: p.categorie,
    risque: p.risque,
    tags: p.tags_marketing || p.tags || [],
    description: p.analyse_courte,
    marche_alternatif: p.marche_alternatif,
    cote_alternatif: p.cote_marche_alternatif,
    is_vip: p.is_vip,
    result: p.result || null,
    generated_at: p.generated_at
  };

  if (includeVipAnalysis) {
    base.analyse_vip = p.analyse_vip;
    base.conseil_bankroll = p.conseil_bankroll;
    base.valeur_detectee = p.valeur_detectee;
    base.scoring_data = p.scoring_data;
  }

  return base;
}

// ── Known "big leagues" our audience cares about ────
const BIG_LEAGUES = [
  'premier league', 'la liga', 'laliga', 'ligue 1', 'bundesliga',
  'serie a', 'champions league', 'europa league', 'conference league',
  'premier league egypte', 'botola', 'caf champions league', 'afcon',
  'nigeria pro league', 'ligue 1 sénégal', "ligue 1 côte d'ivoire"
];
function isBigLeague(competition = '') {
  const c = competition.toLowerCase();
  return BIG_LEAGUES.some(l => c.includes(l));
}

// ─────────────────────────────────────────────────────
// GET /api/pronos/free — Pronos gratuits (public)
// Règle: toujours ≥ 1 prono d'une grande ligue
// ─────────────────────────────────────────────────────
router.get('/free', async (req, res) => {
  const cacheKey = 'pronos_free';
  const mem = memGet(cacheKey);
  if (mem) {
    res.set('X-GOLIAT-Data-Source', 'memory-cache');
    return res.json(mem);
  }

  try {
    const pronoCache = getPronoCache();
    const allPronos = pronoCache.data || [];

    // Start with naturally free pronos
    let freePronos = allPronos.filter(p => !p.is_vip);

    const MAX_FREE = 4;

    // Sort by reliability to show the best ones first
    freePronos = freePronos.sort((a, b) => (b.fiabilite || 0) - (a.fiabilite || 0));

    // Check: is there at least 1 big league among the free pronos we are about to show?
    const hasBigLeagueFree = freePronos.slice(0, MAX_FREE).some(p => isBigLeague(p.competition));

    if (!hasBigLeagueFree) {
      // Promote the best big-league VIP prono to free (highest fiabilite)
      const bigLeagueVip = allPronos
        .filter(p => p.is_vip && isBigLeague(p.competition))
        .sort((a, b) => (b.fiabilite || 0) - (a.fiabilite || 0))[0];

      if (bigLeagueVip) {
        // Temporarily mark as free for this response (don't mutate cache)
        freePronos = [{ ...bigLeagueVip, is_vip: false }, ...freePronos.filter(p => p.fixture_id !== bigLeagueVip.fixture_id)];
        logger.info(`[pronos/free] Auto-promu: ${bigLeagueVip.match} (${bigLeagueVip.competition}) → gratuit`);
      }
    }

    // Ensure minimum 2 free pronos when possible
    if (freePronos.length === 0 && allPronos.length > 0) {
      // Last resort: take top 2 pronos by fiabilite
      freePronos = allPronos
        .sort((a, b) => (b.fiabilite || 0) - (a.fiabilite || 0))
        .slice(0, 2)
        .map(p => ({ ...p, is_vip: false }));
    }

    // Enforce strict limit
    freePronos = freePronos.slice(0, MAX_FREE);

    const formatted = freePronos.map(p => formatProno(p, false));
    memSet(cacheKey, formatted, 300);
    res.set('X-GOLIAT-Data-Source', 'local-json-cache');
    res.json(formatted);
    logger.info(`[pronos/free] ${formatted.length} pronos servis (big league: ${formatted.filter(p => isBigLeague(p.competition)).length})`);
  } catch (err) {
    logger.error('[pronos/free] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur', pronos: [] });
  }
});


// ─────────────────────────────────────────────────────
// GET /api/pronos/vip — Tous les pronos (auth VIP)
// ─────────────────────────────────────────────────────
router.get('/vip', verifyVIP, async (req, res) => {
  const cacheKey = `pronos_vip_${req.user.uid}`;
  const mem = memGet(cacheKey);
  if (mem) {
    res.set('X-GOLIAT-Data-Source', 'memory-cache');
    return res.json(mem);
  }

  try {
    const pronos = getPronos().map(p => formatProno(p, true)); // Include VIP analysis
    memSet(cacheKey, pronos, 180);
    res.set('X-GOLIAT-Data-Source', 'local-json-cache');
    res.json(pronos);
  } catch (err) {
    logger.error('[pronos/vip] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────
// GET /api/pronos/today — Tous les pronos du jour (public preview)
// Pour l'accueil: free + locked VIP (pour la frustration)
// ─────────────────────────────────────────────────────
router.get('/today', optionalAuth, async (req, res) => {
  const localCodeIsVip = hasActiveVipCode(getRequestVipCode(req));
  const firestoreIsVip = req.user ? await checkUserVIP(req.user.uid) : false;
  const isVip = localCodeIsVip || firestoreIsVip;
  const cacheKey = isVip ? 'pronos_today_vip' : 'pronos_today_free';
  const mem = memGet(cacheKey);
  if (mem) {
    res.set('X-GOLIAT-Data-Source', 'memory-cache');
    return res.json(mem);
  }

  try {
    const pronoCache = getPronoCache();
    const allPronos = pronoCache.data || [];

    const result = {
      free: allPronos.filter(p => !p.is_vip).map(p => formatProno(p, isVip)),
      vip_preview: allPronos.filter(p => p.is_vip).map(p => ({
        // Show just enough to create FOMO — no real prono
        id: p.fixture_id,
        match: p.match,
        home_team: p.home_team,
        away_team: p.away_team,
        home_team_logo: p.home_team_logo,
        away_team_logo: p.away_team_logo,
        competition: p.competition,
        kickoff: p.kickoff,
        heure: p.heure,
        categorie: p.categorie,
        is_vip: true,
        locked: !isVip,
        // If VIP, show the real data
        ...(isVip ? formatProno(p, true) : {})
      })),
      meta: {
        total: allPronos.length,
        free_count: allPronos.filter(p => !p.is_vip).length,
        vip_count: allPronos.filter(p => p.is_vip).length,
        generated_at: pronoCache.generatedAt,
        is_stale: pronoCache.isStale,
        max_age_hours: getPronosMaxAgeHours()
      }
    };

    memSet(cacheKey, result, 180);
    res.set('X-GOLIAT-Data-Source', 'local-json-cache');
    res.json(result);
  } catch (err) {
    logger.error('[pronos/today] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────
// GET /api/pronos/history — Historique des résultats
// ─────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  const cacheKey = 'history_v2';
  const mem = memGet(cacheKey);
  if (mem) {
    res.set('X-GOLIAT-Data-Source', 'memory-cache');
    return res.json(mem);
  }

  try {
    // Try local cache first
    const historyCache = cacheGet('history', 168); // 1 week
    let history = historyCache?.data || [];

    // Fallback: compute from pronos cache
    if (!history.length) {
      const allPronos = getPronos();
      history = allPronos
        .filter(p => p.result !== null && p.result !== undefined)
        .map(p => ({
          match: p.match,
          prono: p.prono || p.prono_principal,
          cote: p.cote,
          competition: p.competition,
          kickoff: p.kickoff,
          result: p.result
        }));
    }

    // Compute stats
    const settled = history.filter(p => ['won', 'lost'].includes(p.result));
    const won = settled.filter(p => p.result === 'won').length;

    const result = {
      history,
      stats: {
        total: settled.length,
        won,
        lost: settled.length - won,
        win_rate: settled.length > 0 ? Math.round((won / settled.length) * 100) : 84
      }
    };

    memSet(cacheKey, result, 600);
    res.set('X-GOLIAT-Data-Source', 'local-json-cache');
    res.json(result);
  } catch (err) {
    logger.error('[pronos/history] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────
// GET /api/pronos/cache-status — Debug (admin)
// ─────────────────────────────────────────────────────
router.get('/cache-status', (req, res) => {
  res.json(getCacheInfo());
});

async function checkUserVIP(uid) {
  try {
    const { db } = await import('../firebase/admin.js');
    if (!db) return false;
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return false;
    const { is_vip, vip_expires_at } = doc.data();
    const expiry = vip_expires_at?.toDate?.();
    return is_vip && (!expiry || expiry > new Date());
  } catch { return false; }
}

export default router;
