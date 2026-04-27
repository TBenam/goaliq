/* ====================================================
   GOLIAT — Groq Analyzer v3
   Architecture:
   1. Score every match with Poisson engine
   2. Quality gate: REJECT weak matches
   3. Groq: analyze ONLY viable matches with strict prompt
   4. Post-analysis validation: reject lazy/low-quality Groq output
   5. Output: curated pronos list (max 4 free, rest VIP)
   ==================================================== */

import Groq from 'groq-sdk';
import { cacheGet, cacheWrite, cacheRead } from '../cache/manager.js';
import { scoreMatch, rankMatchesByQuality, generateCoupons } from './scoringEngine.js';
import { logger } from '../utils/logger.js';

let groqClient = null;

function getGroqClient() {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

// ── Maximum free pronos ──────────────────────────────
const MAX_FREE_PRONOS = 4;
const DEFAULT_MAX_GROQ_MATCHES = 35; // Increased from 6 to support 15-20 VIP matches

function getGroqMatchLimit() {
  const parsed = Number.parseInt(process.env.GROQ_MAX_MATCHES_PER_RUN || `${DEFAULT_MAX_GROQ_MATCHES}`, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 20
    ? parsed
    : DEFAULT_MAX_GROQ_MATCHES;
}

// ── System prompt: strict, expert-level ──────────────
const SYSTEM_PROMPT = `Tu es un analyste quantitatif professionnel de paris sportifs pour la plateforme GOLIAT.

MISSION: Fournir des pronostics de haute qualité, variés et rentables (ROI positif).

RÈGLES DE VARIÉTÉ:
1. Tu dois proposer une mixité de paris : "Safe" (cote 1.30-1.60), "Value" (cote 1.70-2.20) et "Grosse Cote" (cote > 2.50).
2. Pour le VIP, tu dois chercher des "Scores Exacts" justifiés par les xG et les tendances H2H.
3. Ne propose PAS que des "Double Chance". Si une victoire sèche est statistiquement solide (>50%), privilégie-la pour offrir une meilleure cote.

RÈGLES ANALYTIQUES:
1. Tu INTERDIS les pronos "Match nul" sauf si la probabilité Poisson du nul est ≥ 35% ET que tu as des signaux de fatigue/rotation.
2. Mieux vaut "SKIP" que produire un prono faible.
3. SMART MONEY : Si le marché fait chuter une cote (Dropping Odds), suis le mouvement si l'info semble solide.
4. VIP : Ton analyse doit être technique (mentionne les xG, les absences, l'enjeu psychologique).

Réponds UNIQUEMENT en JSON valide.`;

// ── Generate analysis for one match ──────────────────
async function analyzeMatchWithGroq(match, scoring) {
  const poissonSummary = scoring.poisson;
  const bestMkt = scoring.bestMarket;
  const h2h = scoring.h2hSummary;
  const apiPred = scoring.apiPredictions;

  const userPrompt = `MATCH: ${match.home_team} vs ${match.away_team}
COMPÉTITION: ${match.league_name} (${match.league_country || ''})
COUP D'ENVOI: ${new Date(match.kickoff).toLocaleString('fr', { weekday:'long', day:'2-digit', month:'long', hour:'2-digit', minute:'2-digit' })}
STADE: ${match.venue || 'Non communiqué'}

═══ MODÈLE POISSON GOLIAT ═══
Victoire domicile: ${poissonSummary.homeWinProb}% | Nul: ${poissonSummary.drawProb}% | Victoire extérieur: ${poissonSummary.awayWinProb}%
xG domicile: ${scoring.homeXg} | xG extérieur: ${scoring.awayXg} | Total xG: ${scoring.totalXg}
Over 2.5: ${poissonSummary.over25Prob}% | Under 2.5: ${100 - poissonSummary.over25Prob}%
BTTS Oui: ${poissonSummary.bttsProb}% | BTTS Non: ${100 - poissonSummary.bttsProb}%
Scores les plus probables: ${poissonSummary.topScores.map(s => `${s.score} (${s.prob}%)`).join(', ')}

═══ FORME RÉCENTE (5 derniers matchs) ═══
Domicile: ${match.home_form || 'N/A'}${scoring.homeForm !== null ? ` (score: ${scoring.homeForm}/100)` : ''}
Extérieur: ${match.away_form || 'N/A'}${scoring.awayForm !== null ? ` (score: ${scoring.awayForm}/100)` : ''}

═══ STATISTIQUES SAISON ═══
Buts marqués/match domicile: ${match.home_goals_avg} | Buts encaissés: ${match.home_goals_conceded}
Buts marqués/match extérieur: ${match.away_goals_avg} | Buts encaissés: ${match.away_goals_conceded}

${h2h ? `═══ CONFRONTATIONS DIRECTES (${h2h.total} matchs) ═══
Victoires domicile: ${h2h.homeWins} | Nuls: ${h2h.draws} | Victoires extérieur: ${h2h.awayWins}
Moyenne de buts: ${h2h.avgGoals}/match` : '═══ H2H: non disponible ═══'}

${apiPred ? `═══ PRÉDICTIONS API-FOOTBALL (algorithme Poisson externe) ═══
Domicile: ${apiPred.homeProb}% | Nul: ${apiPred.drawProb}% | Extérieur: ${apiPred.awayProb}%
Conseil: "${apiPred.advice}"` : '═══ Prédictions API: non disponibles ═══'}

${scoring.injuriesSummary ? `═══ BLESSURES & SUSPENSIONS (Absences confirmées) ═══
Domicile: ${scoring.injuriesSummary.home} absent(s)
Extérieur: ${scoring.injuriesSummary.away} absent(s)
Détails: ${scoring.injuriesSummary.details.map(i => `${i.player} (${i.team_name}: ${i.reason})`).join(', ')}` : '═══ BLESSURES: non communiquées ═══'}

${scoring.standingsSummary ? `═══ CLASSEMENT & ENJEUX MATHÉMATIQUES ═══
Domicile: Classé ${scoring.standingsSummary.homeRank || '?'} ${scoring.standingsSummary.homeDesc ? `(${scoring.standingsSummary.homeDesc})` : ''}
Extérieur: Classé ${scoring.standingsSummary.awayRank || '?'} ${scoring.standingsSummary.awayDesc ? `(${scoring.standingsSummary.awayDesc})` : ''}` : '═══ CLASSEMENT: non disponible ═══'}

${(scoring.nextMatchSummary?.home || scoring.nextMatchSummary?.away) ? `═══ CALENDRIER & RISQUE DE ROTATION (FATIGUE) ═══
${scoring.nextMatchSummary.home ? `Domicile joue: ${scoring.nextMatchSummary.home.opponent} (${scoring.nextMatchSummary.home.competition}) dans ${scoring.nextMatchSummary.home.days_rest} jours` : 'Domicile: pas de match proche'}
${scoring.nextMatchSummary.away ? `Extérieur joue: ${scoring.nextMatchSummary.away.opponent} (${scoring.nextMatchSummary.away.competition}) dans ${scoring.nextMatchSummary.away.days_rest} jours` : 'Extérieur: pas de match proche'}` : '═══ CALENDRIER: non disponible ═══'}

${scoring.bookmakerOdds ? `═══ COTES BOOKMAKERS VS MODÈLE (Détection Smart Money) ═══
Cote réelle Victoire Domicile: @${scoring.bookmakerOdds.home} (Notre cote Poisson: @${(100/poissonSummary.homeWinProb).toFixed(2)})
Cote réelle Victoire Extérieur: @${scoring.bookmakerOdds.away} (Notre cote Poisson: @${(100/poissonSummary.awayWinProb).toFixed(2)})` : '═══ COTES RÉELLES: non disponibles ═══'}

═══ MEILLEUR MARCHÉ IDENTIFIÉ PAR GOLIAT ═══
${bestMkt ? `${bestMkt.label} — ${bestMkt.prob}% (cote estimée ~${bestMkt.estimatedOdds})` : 'Aucun marché dominant'}
Force: ${bestMkt?.strength || 'N/A'} | Confiance globale: ${scoring.confidence} (${scoring.confidenceScore}/100)
Qualite donnees: ${scoring.dataQuality?.score ?? 'N/A'}/100 (${scoring.dataQuality?.level || 'N/A'})
Prix marche: ${bestMkt?.bookmakerOdd ? `bookmaker @${bestMkt.bookmakerOdd}, proba implicite ${bestMkt.impliedProb}%, edge modele ${bestMkt.valueEdge}%` : 'non disponible'}
Priorite IA interne: ${scoring.aiPriorityScore}/100
Signaux: ${scoring.signals.join(' | ') || 'aucun'}
Alertes: ${scoring.warnings.join(' | ') || 'aucune'}

═══ MARCHÉS ALTERNATIFS DÉTECTÉS ═══
${scoring.markets.slice(0, 4).map(m => `- ${m.label}: ${m.prob}% (fair @${m.estimatedOdds}${m.bookmakerOdd ? ` | book @${m.bookmakerOdd} | edge ${m.valueEdge}%` : ''})`).join('\n')}

INSTRUCTIONS:
1. Évalue si ce match mérite un pronostic. Si les données sont trop pauvres ou le match trop incertain, renvoie { "skip": true, "reason": "..." }
2. Si un prono est viable, choisis le MEILLEUR marché parmi ceux proposés. NE CHOISIS PAS "Match Nul" sauf justification exceptionnelle.
3. Ta cote_estimee doit être réaliste (dérivée de la probabilité: cote ≈ 100/probabilité).
4. Ta fiabilite doit refléter la convergence des signaux (Poisson + forme + H2H + API).

JSON requis:
{
  "skip": false,
  "prono_principal": "Victoire Manchester City",
  "cote_estimee": 1.85,
  "fiabilite": 72,
  "categorie": "Safe|Value|Score Exact|BTTS|Grosse Cote",
  "analyse_courte": "2 phrases percutantes pour les non-VIP.",
  "analyse_vip": "Analyse tactique complète 100-150 mots. Mentionne xG, Poisson, forme, H2H, facteurs clés. Style expert.",
  "marche_alternatif": "Over 2.5",
  "cote_marche_alternatif": 1.65,
  "risque": "Faible|Moyen|Élevé",
  "valeur_detectee": true,
  "tags_marketing": ["Tag1", "Tag2"],
  "conseil_bankroll": "2% de mise"
}`;

  try {
    const groq = getGroqClient();
    if (!groq) throw new Error('GROQ_API_KEY manquant');

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.15,  // Even more deterministic
      max_tokens: 900,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);

    // ── Post-Analysis Validation ──────────────────────
    if (result.skip) {
      logger.info(`  ⏭️  ${match.home_team} vs ${match.away_team} → SKIP: ${result.reason}`);
      return null;
    }

    // Reject lazy "match nul" unless Poisson supports it
    if (result.prono_principal && result.prono_principal.toLowerCase().includes('match nul')) {
      if (poissonSummary.drawProb < 30) {
        logger.warn(`  🚫 ${match.home_team} vs ${match.away_team} → Rejeté: "Match Nul" avec seulement ${poissonSummary.drawProb}% de probabilité Poisson`);
        // Force use the best market from our engine instead
        if (bestMkt) {
          result.prono_principal = bestMkt.label;
          result.cote_estimee = bestMkt.estimatedOdds;
          result.fiabilite = Math.min(result.fiabilite || 65, Math.round(bestMkt.prob * 0.9));
          logger.info(`  🔄 Remplacé par: ${bestMkt.label} @${bestMkt.estimatedOdds}`);
        } else {
          return null; // No viable alternative
        }
      }
    }

    // Reject inflated fiabilite
    if (result.fiabilite > 90) result.fiabilite = 85;
    if (scoring.confidence === 'low' && result.fiabilite > 70) result.fiabilite = 65;
    if (scoring.confidence === 'medium' && result.fiabilite > 82) result.fiabilite = 78;

    return {
      ...result,
      analysis_source: 'groq',
      analysis_model: 'llama-3.3-70b-versatile'
    };
  } catch (err) {
    logger.warn(`[Groq] Erreur ${match.home_team} vs ${match.away_team}:`, err.message);
    const fallback = buildFallbackAnalysis(match, scoring);
    if (!fallback) return null;
    return {
      ...fallback,
      analysis_source: 'fallback',
      analysis_error: err.message
    };
  }
}

// ── Fallback if Groq fails (uses scoring engine directly) ─
function buildFallbackAnalysis(match, scoring) {
  const bestMkt = scoring.bestMarket;
  if (!bestMkt) return null; // No market = no prono

  return {
    skip: false,
    prono_principal: bestMkt.label,
    cote_estimee: bestMkt.estimatedOdds,
    fiabilite: Math.min(70, Math.round(bestMkt.prob * 0.85)),
    categorie: bestMkt.prob >= 65 ? 'Safe' : 'Value',
    analyse_courte: `GOLIAT retient ce marche car plusieurs signaux convergent. ${scoring.signals.slice(0, 2).join('. ')}.`,
    analyse_vip: `Lecture GOLIAT: xG ${match.home_team} ${scoring.homeXg} | ${match.away_team} ${scoring.awayXg}. ${scoring.signals.join('. ')}. ${scoring.warnings.length > 0 ? 'Points de vigilance: ' + scoring.warnings.join('. ') : ''}`,
    marche_alternatif: scoring.markets[1]?.label || 'Double Chance',
    cote_marche_alternatif: scoring.markets[1]?.estimatedOdds || 1.40,
    risque: scoring.confidence === 'high' ? 'Faible' : 'Moyen',
    valeur_detectee: bestMkt.strength === 'strong' || bestMkt.valueEdge >= 3,
    tags_marketing: [match.league_name, bestMkt.type.replace('_', ' ')],
    conseil_bankroll: scoring.confidence === 'high' ? '3% de mise' : '2% de mise'
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
    cacheWrite('pronos', []);
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

  // Filter matches for today + tomorrow
  const allMatches = matchCache.data.filter(m => {
    const kickoff = new Date(m.kickoff);
    return kickoff >= today && kickoff < horizon;
  });

  logger.info(`[Pipeline] 📋 ${allMatches.length} matchs dans le pipeline`);

  // ── STEP 1: Score ALL matches with Poisson engine ──
  logger.info('[Pipeline] 🧮 Étape 1: Scoring Poisson de tous les matchs...');
  const ranked = rankMatchesByQuality(allMatches);

  logger.info(`[Pipeline] ✅ ${ranked.length}/${allMatches.length} matchs ont passé le Quality Gate`);
  const rejected = allMatches.length - ranked.length;
  if (rejected > 0) {
    logger.info(`[Pipeline] 🚫 ${rejected} matchs rejetés (données insuffisantes ou match trop incertain)`);
  }

  if (ranked.length === 0) {
    logger.warn('[Pipeline] Aucun match n\'a passé le Quality Gate. Aucun prono généré.');
    cacheWrite('pronos', []);
    return [];
  }

  // ── STEP 2: Separate VIP (Groq) and Free (Algorithmic) ──
  const VIP_TARGET = 18;
  const FREE_TARGET = 5;

  const vipCandidates = ranked.slice(0, VIP_TARGET);
  const freeCandidates = ranked.slice(VIP_TARGET, VIP_TARGET + FREE_TARGET);

  logger.info(`[Pipeline] 🎯 Plan: ${vipCandidates.length} VIP (IA Groq) | ${freeCandidates.length} Gratuits (Scoring Math)`);

  const pronos = [];
  let freeCount = 0, vipCount = 0, skipped = 0;

  // --- Process VIP (Groq AI) ---
  for (const { match, scoring } of vipCandidates) {
    const analysis = await analyzeMatchWithGroq(match, scoring);
    if (!analysis || analysis.skip) {
      skipped++;
      continue;
    }

    const prono = buildPronoObject(match, scoring, analysis, true);
    pronos.push(prono);
    vipCount++;
    
    logger.info(`  ✓ [VIP] ${match.home_team} vs ${match.away_team} (IA)`);
    await tryFirestoreSave(prono);
    await new Promise(r => setTimeout(r, 800)); // Rate limit
  }

  // --- Process Free (Algorithmic / Prioritaire) ---
  for (const { match, scoring } of freeCandidates) {
    const analysis = buildFallbackAnalysis(match, scoring);
    if (!analysis) continue;

    const prono = buildPronoObject(match, scoring, analysis, false);
    pronos.push(prono);
    freeCount++;

    logger.info(`  ✓ [FREE] ${match.home_team} vs ${match.away_team} (Prioritaire)`);
    await tryFirestoreSave(prono);
  }

  // Helper to build the final object
  function buildPronoObject(match, scoring, analysis, isVip) {
    return {
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
      scoring_data: {
        homeXg: scoring.homeXg,
        awayXg: scoring.awayXg,
        poisson: scoring.poisson,
        confidence: scoring.confidence,
        confidenceScore: scoring.confidenceScore,
        dataQuality: scoring.dataQuality,
        aiPriorityScore: scoring.aiPriorityScore,
        bestMarket: scoring.bestMarket,
        topScores: scoring.topScores
      },
      internal_audit: {
        analysis_source: isVip ? 'groq_ai' : 'scoring_engine',
        analysis_model: analysis.analysis_model || null,
        generated_at: new Date().toISOString()
      }
    };
  }

  // ── STEP 3: Generate Coupons ──────────────────────
  const coupons = generateCoupons(pronos);
  
  // ── STEP 4: Select "Prono VIP Offert" ──────────────
  // Pick the best VIP prono (High reliability + Good competition) to offer for free
  const bestVip = pronos
    .filter(p => p.is_vip && !['Score Exact', 'Grosse Cote'].includes(p.categorie))
    .sort((a, b) => (b.fiabilite || 0) - (a.fiabilite || 0))[0];
  
  if (bestVip) {
    bestVip.is_offered_free = true;
    logger.info(`  🎁 Prono VIP Offert: ${bestVip.match}`);
  }

  // ── Save to local cache (PRIMARY) ──────────────────
  cacheWrite('pronos', pronos);
  cacheWrite('coupons', coupons);

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(`[Pipeline] ═══════════════════════════════════════════`);
  logger.info(`[Pipeline] ✅ RÉSULTAT FINAL:`);
  logger.info(`[Pipeline]    ${pronos.length} pronos publiés | ${coupons.length} combinés générés`);
  logger.info(`[Pipeline]    ${freeCount} gratuits | ${vipCount} VIP`);
  logger.info(`[Pipeline]    ${skipped} matchs skippés par l'IA`);
  logger.info(`[Pipeline] ═══════════════════════════════════════════`);

  // Send FCM push notification ONLY if there are new/different pronos
  if (pronos.length > 0 && hasNewProno) {
    await notifySubscribers(pronos.length, freeCount);
  } else if (pronos.length > 0) {
    logger.info(`[Pipeline] Pas de nouveaux pronos détectés, notification ignorée.`);
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
