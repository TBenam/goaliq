/* ====================================================
   GOLIAT — Groq Analyzer (v2)
   - Lit les matchs depuis le cache local (pas Firestore)
   - Génère les analyses avec Llama-3.3-70b
   - Sauvegarde les pronos en JSON local (cache/data/pronos.json)
   - Firestore optionnel (si service account disponible)
   ==================================================== */

import Groq from 'groq-sdk';
import { cacheGet, cacheWrite, cacheRead } from '../cache/manager.js';
import { scoreMatch } from './scoringEngine.js';
import { logger } from '../utils/logger.js';

let groqClient = null;

function getGroqClient() {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

const SYSTEM_PROMPT = `Tu es Jean-Marc, analyste sportif senior pour GOLIAT.
Spécialiste des marchés de paris, tu analyses les matchs avec précision et sans biais.
Ton audience : parieurs sérieux du marché francophone africain qui cherchent de la vraie valeur.
Réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks.`;

// ── Generate analysis for one match ──────────────────
async function analyzeMatchWithGroq(match) {
  const scoring = scoreMatch(match);

  const userPrompt = `Analyse ce match et génère un pronostic actionnable.

MATCH: ${match.home_team} vs ${match.away_team}
COMPÉTITION: ${match.league_name} ${match.league_flag || ''}
COUP D'ENVOI: ${new Date(match.kickoff).toLocaleString('fr', { weekday:'long', day:'2-digit', month:'long', hour:'2-digit', minute:'2-digit' })}
STADE: ${match.venue || 'Non communiqué'}

━━ STATISTIQUES ━━
Forme récente domicile (5J): ${match.home_form || 'N/A'} 
Forme récente extérieur (5J): ${match.away_form || 'N/A'}
Buts marqués/match domicile: ${match.home_goals_avg}
Buts encaissés/match domicile: ${match.home_goals_conceded}
Buts marqués/match extérieur: ${match.away_goals_avg}
Buts encaissés/match extérieur: ${match.away_goals_conceded}

━━ SCORING ALGORITHMIQUE GOLIAT ━━
Score domicile (0-100): ${scoring.home_win_score}
Probabilité Over 2.5: ${scoring.over25_prob}%
Probabilité BTTS: ${scoring.btts_prob}%
xG estimé domicile: ${scoring.home_expected_goals} | xG extérieur: ${scoring.away_expected_goals}
Signaux détectés: ${scoring.signals.join(', ') || 'aucun signal dominant'}
Risques détectés: ${scoring.warnings.join(', ') || 'aucun'}
Recommandation algo: ${scoring.recommendation} | Confiance: ${scoring.confidence}

Génère ce JSON EXACT (respecte les types):
{
  "prono_principal": "ex: Victoire Real Madrid / Plus de 2.5 buts / BTTS",
  "cote_estimee": 1.85,
  "fiabilite": 82,
  "categorie": "Safe",
  "analyse_courte": "2 phrases factuel sans jargon pour les non-VIP.",
  "analyse_vip": "Analyse tactique complète 100-150 mots avec xG, forme, facteurs clés. Style journal expert.",
  "marche_alternatif": "BTTS",
  "cote_marche_alternatif": 1.65,
  "risque": "Faible",
  "valeur_detectee": true,
  "tags_marketing": ["Tag1", "Tag2"],
  "conseil_bankroll": "2% de mise"
}
Note: categorie doit être l'un de: Safe, Value, Score Exact, BTTS, Grosse Cote`;

  try {
    const groq = getGroqClient();
    if (!groq) {
      throw new Error('GROQ_API_KEY manquant');
    }

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    logger.warn(`[Groq] Erreur ${match.home_team} vs ${match.away_team}:`, err.message);
    return buildFallbackAnalysis(match, scoring);
  }
}

// ── Fallback if Groq fails ────────────────────────────
function buildFallbackAnalysis(match, scoring) {
  const rec = scoring.recommendation;
  let prono, cote;

  if (rec === 'home_win') { prono = `Victoire ${match.home_team}`; cote = 1.75; }
  else if (rec === 'away_win') { prono = `Victoire ${match.away_team}`; cote = 2.10; }
  else if (rec === 'over25') { prono = 'Plus de 2.5 buts'; cote = 1.80; }
  else { prono = 'Les deux équipes marquent'; cote = 1.65; }

  return {
    prono_principal: prono,
    cote_estimee: cote,
    fiabilite: Math.max(55, scoring.home_win_score),
    categorie: scoring.confidence === 'high' ? 'Safe' : 'Value',
    analyse_courte: `Analyse basée sur la forme récente et les statistiques de buts de la saison.`,
    analyse_vip: `Score algorithmique ${scoring.home_win_score}/100. xG estimé: ${match.home_team} ${scoring.home_expected_goals} | ${match.away_team} ${scoring.away_expected_goals}. ${scoring.signals.join('. ')}.`,
    marche_alternatif: scoring.over25_prob >= 65 ? 'Over 2.5' : 'Double Chance',
    cote_marche_alternatif: 1.50,
    risque: scoring.confidence === 'high' ? 'Faible' : 'Moyen',
    valeur_detectee: false,
    tags_marketing: scoring.signals.slice(0, 2),
    conseil_bankroll: '2% de mise conseillé'
  };
}

// ── Try save to Firestore (optional) ─────────────────
async function tryFirestoreSave(pronoData) {
  try {
    const { db } = await import('../firebase/admin.js');
    const admin = (await import('../firebase/admin.js')).default;
    if (!db) return;

    await db.collection('pronos')
      .doc(String(pronoData.fixture_id))
      .set({ ...pronoData }, { merge: true });
  } catch { /* Firestore optionnel */ }
}

// ── Main pipeline: analyze all matches from cache ─────
export async function runDailyAnalysis() {
  const start = Date.now();

  if (!process.env.GROQ_API_KEY) {
    logger.error('[Groq] GROQ_API_KEY manquant !');
    return [];
  }

  // ── Read matches from local cache ──────────────────
  const matchCache = cacheGet('matches', 24); // Accept matches up to 24h old
  if (!matchCache?.data?.length) {
    logger.warn('[Groq] Aucun match en cache. Lance collectMatches() d\'abord.');
    return [];
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + 2 * 86400000);

  // Filter matches for today + tomorrow to mirror the collector horizon
  const matchesToAnalyze = matchCache.data.filter(m => {
    const kickoff = new Date(m.kickoff);
    return kickoff >= today && kickoff < horizon;
  });

  logger.info(`[Groq] 🧠 Analyse de ${matchesToAnalyze.length} matchs avec Llama-3.3-70b...`);

  const pronos = [];
  let freeCount = 0, vipCount = 0;

  for (const match of matchesToAnalyze) {
    const analysis = await analyzeMatchWithGroq(match);

    // Determine if VIP content
    const isVip = analysis.fiabilite >= 78
      || ['Score Exact', 'Grosse Cote'].includes(analysis.categorie)
      || analysis.cote_estimee >= 3.0;

    const prono = {
      fixture_id: match.fixture_id,
      match: `${match.home_team} vs ${match.away_team}`,
      home_team: match.home_team,
      away_team: match.away_team,
      home_team_logo: match.home_team_logo,
      away_team_logo: match.away_team_logo,
      competition: match.league_name,
      league_flag: match.league_flag,
      kickoff: match.kickoff,
      heure: new Date(match.kickoff).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' }),
      venue: match.venue,
      ...analysis,
      prono: analysis.prono_principal,
      cote: analysis.cote_estimee,
      fiabilite: analysis.fiabilite,
      is_vip: isVip,
      result: null,
      scoring_data: scoreMatch(match),
      generated_at: new Date().toISOString()
    };

    pronos.push(prono);
    if (isVip) vipCount++; else freeCount++;

    logger.info(`  ✓ ${match.home_team} vs ${match.away_team} → ${analysis.prono_principal} @${analysis.cote_estimee} (${analysis.fiabilite}%) ${isVip ? '[VIP]' : '[FREE]'}`);

    // Optional Firestore save
    await tryFirestoreSave(prono);

    // 600ms pause between Groq calls (rate limit)
    await new Promise(r => setTimeout(r, 600));
  }

  // ── Save to local cache (PRIMARY) ──────────────────
  if (pronos.length > 0) {
    cacheWrite('pronos', pronos);
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(`[Groq] ✅ ${pronos.length} pronos générés en ${duration}s (${freeCount} gratuits, ${vipCount} VIP)`);

  // Send FCM push notification
  if (pronos.length > 0) {
    await notifySubscribers(pronos.length, freeCount);
  }

  return pronos;
}

// ── FCM notifications (optional) ─────────────────────
async function notifySubscribers(total, freeCount) {
  try {
    const { db, sendPushToTokens } = await import('../firebase/admin.js');
    if (!db) return;

    const snap = await db.collection('fcm_tokens').get();
    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) return;

    await sendPushToTokens(tokens, {
      title: `🔥 GOLIAT — ${total} pronos du jour prêts !`,
      body: `${freeCount} analyses disponibles maintenant. Ouvrez l'app !`
    }, { url: '/#pronos', type: 'new_pronos' });

    logger.info(`[FCM] Notification envoyée à ${tokens.length} abonnés`);
  } catch { /* FCM optionnel */ }
}
