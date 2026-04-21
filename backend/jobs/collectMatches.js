/* ====================================================
   GoalIQ — Data Collector (v2)
   - Collecte les matchs depuis API-Football
   - Sauvegarde en cache JSON local (prioritaire)
   - Sauvegarde aussi dans Firestore si disponible
   - Les clients NE touchent JAMAIS à l'API externe
   ==================================================== */

import axios from 'axios';
import { cacheWrite, cacheRead } from '../cache/manager.js';
import { logger } from '../utils/logger.js';

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE = 'https://v3.football.api-sports.io';

// ── Priorité des championnats (score 1-100) ───────────
// Plus le score est élevé, plus la ligue est suivie par notre audience
const LEAGUE_SCORES = {
  2: 100,   // Champions League
  3: 90,    // Europa League
  39: 85,   // Premier League
  140: 85,  // LaLiga
  61: 80,   // Ligue 1
  78: 80,   // Bundesliga
  135: 80,  // Serie A
  88: 75,   // Eredivisie
  94: 70,   // Primeira Liga
  179: 70,  // Scottish PL
  12: 90,   // CAF Champions League
  20: 85,   // AFCON
  202: 75,  // Botola Pro Maroc
  233: 75,  // Ligue 1 Sénégal
  260: 70,  // Ligue 1 Côte d'Ivoire
  272: 70,  // Ligue 1 Cameroun
  107: 70,  // Nigeria Pro League
  169: 65,  // Ligue 1 Mauritanie
  73: 65,   // Copa do Brasil
  253: 60,  // MLS
  848: 75,  // Conference League
};

const CURRENT_SEASON = new Date().getUTCFullYear();

// ── API-Football client ───────────────────────────────
const afClient = axios.create({
  baseURL: BASE,
  headers: { 'x-apisports-key': API_KEY },
  timeout: 15000
});

// ── Fetch team stats (with retry) ────────────────────
async function fetchTeamStats(teamId, leagueId, season = CURRENT_SEASON) {
  try {
    const { data } = await afClient.get('/teams/statistics', {
      params: { team: teamId, league: leagueId, season }
    });
    return data.response || null;
  } catch {
    // Try previous season as fallback
    try {
      const { data } = await afClient.get('/teams/statistics', {
        params: { team: teamId, league: leagueId, season: season - 1 }
      });
      return data.response || null;
    } catch { return null; }
  }
}

// ── Fetch all fixtures for a given date ───────────────
async function fetchAllFixturesByDate(date) {
  try {
    const { data } = await afClient.get('/fixtures', { params: { date } });
    return data.response || [];
  } catch (err) {
    logger.warn(`[Collector] Erreur fetchFixtures(${date}): ${err.message}`);
    return [];
  }
}

// ── Score a league by known priority ─────────────────
function getLeagueScore(leagueId) {
  return LEAGUE_SCORES[leagueId] || 0;
}

// ── Build a match object from API fixture ─────────────
async function buildMatchObject(fixture, leagueScore) {
  const leagueId = fixture.league.id;
  const season = fixture.league.season || CURRENT_SEASON;
  const [homeStats, awayStats] = await Promise.all([
    fetchTeamStats(fixture.teams.home.id, leagueId, season),
    fetchTeamStats(fixture.teams.away.id, leagueId, season)
  ]);

  // Determine flag emoji
  const flag = fixture.league.flag
    ? fixture.league.flag
    : '🌍';

  return {
    fixture_id: fixture.fixture.id,
    league_id: leagueId,
    league_name: fixture.league.name,
    league_flag: flag,
    league_country: fixture.league.country,
    league_score: leagueScore,
    home_team: fixture.teams.home.name,
    away_team: fixture.teams.away.name,
    home_team_id: fixture.teams.home.id,
    away_team_id: fixture.teams.away.id,
    home_team_logo: fixture.teams.home.logo,
    away_team_logo: fixture.teams.away.logo,
    kickoff: fixture.fixture.date,
    venue: fixture.fixture.venue?.name || null,
    referee: fixture.fixture.referee || null,
    home_form: homeStats?.form || null,
    away_form: awayStats?.form || null,
    home_goals_avg: parseFloat(homeStats?.goals?.for?.average?.total || 1.2),
    away_goals_avg: parseFloat(awayStats?.goals?.for?.average?.total || 1.0),
    home_goals_conceded: parseFloat(homeStats?.goals?.against?.average?.total || 1.2),
    away_goals_conceded: parseFloat(awayStats?.goals?.against?.average?.total || 1.2),
    status: fixture.fixture.status.short,
    prono_generated: false,
    collected_at: new Date().toISOString()
  };
}

// ── Try to save to Firestore (optional) ──────────────
async function tryFirestoreSave(matches) {
  try {
    const { db } = await import('../firebase/admin.js');
    const admin = (await import('../firebase/admin.js')).default;
    if (!db) return;
    const batch = db.batch();
    for (const m of matches) {
      const ref = db.collection('matches').doc(String(m.fixture_id));
      batch.set(ref, { ...m }, { merge: true });
    }
    await batch.commit();
    logger.info(`[Firestore] ${matches.length} matchs sauvegardés`);
  } catch (err) {
    logger.warn('[Firestore] Non disponible, cache local uniquement:', err.message);
  }
}

// ── Main: fetch all matches ───────────────────────────
export async function fetchMatches() {
  if (!API_KEY) {
    logger.error('[Collector] API_FOOTBALL_KEY manquant dans .env !');
    return [];
  }

  logger.info('[Collector] 🚀 Démarrage collecte API-Football...');

  // Collect today + tomorrow
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  logger.info(`[Collector] Dates: ${today} → ${tomorrow}`);

  // Fetch all fixtures for both days in 2 calls
  const [todayFixtures, tomorrowFixtures] = await Promise.all([
    fetchAllFixturesByDate(today),
    fetchAllFixturesByDate(tomorrow)
  ]);

  const allFixtures = [...todayFixtures, ...tomorrowFixtures];
  logger.info(`[Collector] ${allFixtures.length} matchs bruts récupérés (${todayFixtures.length} ce soir + ${tomorrowFixtures.length} demain)`);

  if (allFixtures.length === 0) {
    logger.warn('[Collector] Aucun match trouvé depuis l\'API.');
    return [];
  }

  // ── Filter: only known leagues (score > 0) ─────────
  const eligibleFixtures = allFixtures
    .filter(f => getLeagueScore(f.league.id) > 0)
    .sort((a, b) => getLeagueScore(b.league.id) - getLeagueScore(a.league.id))
    .slice(0, 20); // Max 20 matchs par cycle (protège le quota API)

  logger.info(`[Collector] ${eligibleFixtures.length} matchs éligibles (ligues prioritaires)`);

  // ── Fetch stats for each match ─────────────────────
  const allMatches = [];
  for (const fixture of eligibleFixtures) {
    const leagueScore = getLeagueScore(fixture.league.id);
    const match = await buildMatchObject(fixture, leagueScore);
    allMatches.push(match);
    logger.info(`  ✓ [${match.league_name}] ${match.home_team} vs ${match.away_team} — ${match.heure || match.kickoff}`);
    await new Promise(r => setTimeout(r, 350)); // rate limit
  }

  // Sort by kickoff time
  allMatches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  // ── Save to local cache (PRIMARY) ──────────────────
  cacheWrite('matches', allMatches);

  // ── Try Firestore (SECONDARY, optional) ────────────
  await tryFirestoreSave(allMatches);

  logger.info(`[Collector] ✅ ${allMatches.length} matchs collectés et mis en cache`);
  return allMatches;
}


// ── Update match results (called after matches finish) ─
export async function updateResults() {
  const cached = cacheRead('matches');
  if (!cached?.data) return;

  const pastMatches = cached.data.filter(m => {
    const kickoff = new Date(m.kickoff);
    const now = new Date();
    const ageH = (now - kickoff) / 3600000;
    // Matches from 1.5h to 24h ago that aren't finished
    return ageH >= 1.5 && ageH <= 24 && !['FT','AET','PEN','CANC','ABD'].includes(m.status);
  });

  if (!pastMatches.length) return;
  logger.info(`[Collector] Mise à jour de ${pastMatches.length} résultats...`);

  let updated = 0;
  for (const match of pastMatches) {
    try {
      const { data } = await afClient.get('/fixtures', { params: { id: match.fixture_id } });
      const fixture = data.response?.[0];
      if (!fixture) continue;

      match.status = fixture.fixture.status.short;
      match.score_home = fixture.goals.home;
      match.score_away = fixture.goals.away;
      updated++;

      await new Promise(r => setTimeout(r, 300));
    } catch { continue; }
  }

  if (updated > 0) {
    cacheWrite('matches', cached.data);
    logger.info(`[Collector] ✅ ${updated} résultats mis à jour`);
  }
}
