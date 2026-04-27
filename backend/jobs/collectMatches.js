/* ====================================================
   GOLIAT — Data Collector v3
   - Collecte les matchs depuis API-Football
   - Enrichit avec H2H + Predictions API
   - Sauvegarde en cache JSON local (prioritaire)
   - Sauvegarde aussi dans Firestore si disponible
   - Les clients NE touchent JAMAIS à l'API externe
   ==================================================== */

import axios from 'axios';
import { cacheWrite, cacheRead } from '../cache/manager.js';
import {
  extractConsensusOdds,
  fetchOddsEventsForSport,
  getMaxSportKeysPerRun,
  getSportKeyForLeague
} from './theOddsApiClient.js';
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

// ── Rate limiter ──────────────────────────────────────
async function rateLimitPause(ms = 400) {
  return new Promise(r => setTimeout(r, ms));
}

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

// ── Fetch API-Football predictions for a fixture ─────
async function fetchPredictions(fixtureId) {
  try {
    const { data } = await afClient.get('/predictions', {
      params: { fixture: fixtureId }
    });
    const pred = data.response?.[0];
    if (!pred) return null;

    return {
      winner: pred.predictions?.winner?.name || null,
      advice: pred.predictions?.advice || null,
      percent: {
        home: pred.predictions?.percent?.home?.replace('%', '') || null,
        draw: pred.predictions?.percent?.draw?.replace('%', '') || null,
        away: pred.predictions?.percent?.away?.replace('%', '') || null
      },
      goals: pred.predictions?.goals || null,
      comparison: pred.comparison || null
    };
  } catch (err) {
    logger.debug(`[Collector] Predictions non dispo pour fixture ${fixtureId}: ${err.message}`);
    return null;
  }
}

// ── Fetch H2H between two teams ──────────────────────
async function fetchH2H(homeTeamId, awayTeamId) {
  try {
    const { data } = await afClient.get('/fixtures/headtohead', {
      params: { h2h: `${homeTeamId}-${awayTeamId}`, last: 5 }
    });
    const matches = data.response || [];
    return matches.map(m => ({
      date: m.fixture?.date,
      home_team: m.teams?.home?.name,
      away_team: m.teams?.away?.name,
      home_goals: m.goals?.home ?? null,
      away_goals: m.goals?.away ?? null,
      league: m.league?.name
    }));
  } catch (err) {
    logger.debug(`[Collector] H2H non dispo: ${err.message}`);
    return [];
  }
}

// ── Fetch Injuries ────────────────────────────────────
async function fetchInjuries(fixtureId) {
  try {
    const { data } = await afClient.get('/injuries', { params: { fixture: fixtureId } });
    if (!data.response || data.response.length === 0) return [];
    
    return data.response.map(inj => ({
      player: inj.player.name,
      team_id: inj.team.id,
      team_name: inj.team.name,
      reason: inj.player.reason || inj.player.type || 'Absent'
    }));
  } catch (err) {
    return [];
  }
}

// ── Fetch Pre-Match Odds ──────────────────────────────
async function fetchOdds(fixtureId) {
  try {
    const { data } = await afClient.get('/odds', { params: { fixture: fixtureId } });
    const bookmaker = data.response?.[0]?.bookmakers?.[0]; // Usually first available (Bet365/1xBet)
    if (!bookmaker) return null;
    
    const matchWinner = bookmaker.bets.find(b => b.name === 'Match Winner');
    if (!matchWinner) return null;

    return {
      home: parseFloat(matchWinner.values.find(v => v.value === 'Home')?.odd || 0),
      draw: parseFloat(matchWinner.values.find(v => v.value === 'Draw')?.odd || 0),
      away: parseFloat(matchWinner.values.find(v => v.value === 'Away')?.odd || 0),
      provider: 'api-football',
      fetched_at: new Date().toISOString()
    };
  } catch (err) {
    return null;
  }
}

// ── Local cache for standings during collection ────────
const standingsCache = {};

// ── Fetch Standings (Mathematical Stakes) ─────────────
async function fetchStandings(leagueId, season) {
  const cacheKey = `${leagueId}-${season}`;
  if (standingsCache[cacheKey]) return standingsCache[cacheKey];

  try {
    const { data } = await afClient.get('/standings', { params: { league: leagueId, season: season } });
    const standings = data.response?.[0]?.league?.standings?.[0] || [];
    const formatted = standings.map(s => ({
      rank: s.rank,
      team_id: s.team.id,
      points: s.points,
      description: s.description // e.g., "Promotion - Champions League", "Relegation"
    }));
    standingsCache[cacheKey] = formatted;
    return formatted;
  } catch (err) {
    return [];
  }
}

// ── Fetch Next Match (Fatigue/Rotation Risk) ──────────
async function fetchNextMatch(teamId, currentDateStr) {
  try {
    const { data } = await afClient.get('/fixtures', { params: { team: teamId, next: 1 } });
    const nextFixture = data.response?.[0];
    if (!nextFixture) return null;
    
    const current = new Date(currentDateStr);
    const nextMatchDate = new Date(nextFixture.fixture.date);
    const diffDays = (nextMatchDate - current) / (1000 * 60 * 60 * 24);
    
    return {
      date: nextFixture.fixture.date,
      competition: nextFixture.league.name,
      opponent: nextFixture.teams.home.id === teamId ? nextFixture.teams.away.name : nextFixture.teams.home.name,
      days_rest: Math.round(diffDays)
    };
  } catch (err) {
    return null;
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

async function enrichMatchesWithTheOddsApi(matches) {
  if (!process.env.THE_ODDS_API_KEY && !process.env.ODDS_API_KEY) {
    return matches;
  }

  const sportKeys = [...new Set(matches.map(m => m.odds_sport_key).filter(Boolean))]
    .slice(0, getMaxSportKeysPerRun());

  if (!sportKeys.length) {
    logger.info('[TheOddsAPI] Aucune ligue eligible pour le mapping odds.');
    return matches;
  }

  const commenceTimeFrom = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const commenceTimeTo = new Date(Date.now() + 2 * 86400000).toISOString();
  const eventsBySport = new Map();

  for (const sportKey of sportKeys) {
    const events = await fetchOddsEventsForSport(sportKey, { commenceTimeFrom, commenceTimeTo });
    eventsBySport.set(sportKey, events);
    await rateLimitPause(250);
  }

  let enriched = 0;
  for (const match of matches) {
    const events = eventsBySport.get(match.odds_sport_key) || [];
    const odds = extractConsensusOdds(match, events);
    if (!odds) continue;

    match.bookmaker_odds = odds;
    match.the_odds_api_odds = odds;
    match.external_sources = {
      ...(match.external_sources || {}),
      odds: 'the-odds-api'
    };
    enriched++;
  }

  logger.info(`[TheOddsAPI] ${enriched}/${matches.length} matchs enrichis avec consensus bookmaker`);
  return matches;
}

// ── Build a match object from API fixture ─────────────
async function buildMatchObject(fixture, leagueScore) {
  const leagueId = fixture.league.id;
  const season = fixture.league.season || CURRENT_SEASON;
  const fixtureId = fixture.fixture.id;
  const homeTeamId = fixture.teams.home.id;
  const awayTeamId = fixture.teams.away.id;

  logger.info(`  📊 Enrichissement: ${fixture.teams.home.name} vs ${fixture.teams.away.name}...`);

  // Fetch all enrichment data in parallel
  const [homeStats, awayStats, predictions, h2h, injuries, apiFootballOdds, standings, homeNextMatch, awayNextMatch] = await Promise.all([
    fetchTeamStats(homeTeamId, leagueId, season),
    fetchTeamStats(awayTeamId, leagueId, season),
    fetchPredictions(fixtureId),
    fetchH2H(homeTeamId, awayTeamId),
    fetchInjuries(fixtureId),
    fetchOdds(fixtureId),
    fetchStandings(leagueId, season),
    fetchNextMatch(homeTeamId, fixture.fixture.date),
    fetchNextMatch(awayTeamId, fixture.fixture.date)
  ]);

  // Determine flag emoji
  const flag = fixture.league.flag
    ? fixture.league.flag
    : '🌍';

  const oddsSportKey = getSportKeyForLeague(leagueId);

  return {
    fixture_id: fixtureId,
    league_id: leagueId,
    league_name: fixture.league.name,
    league_flag: flag,
    league_country: fixture.league.country,
    league_score: leagueScore,
    home_team: fixture.teams.home.name,
    away_team: fixture.teams.away.name,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
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
    // NEW: Enriched data
    api_predictions: predictions,
    h2h: h2h,
    injuries: injuries,
    bookmaker_odds: apiFootballOdds,
    api_football_odds: apiFootballOdds,
    odds_sport_key: oddsSportKey,
    xg_metrics: null,
    expected_lineups: null,
    weather: null,
    external_sources: {
      odds: apiFootballOdds ? apiFootballOdds.provider : null,
      xg: null,
      expected_lineups: null,
      weather: null
    },
    standings: standings,
    home_next_match: homeNextMatch,
    away_next_match: awayNextMatch,
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
      batch.set(ref, {
        ...m,
        // Firestore doesn't support nested arrays well, flatten for storage
        h2h_count: m.h2h?.length || 0,
        api_prediction_advice: m.api_predictions?.advice || null
      }, { merge: true });
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

  logger.info('[Collector] 🚀 Démarrage collecte API-Football v3...');

  // Collect today + tomorrow
  const options = { timeZone: 'Africa/Douala' };
  const today = new Date().toLocaleString('en-CA', options).split(',')[0];
  const tomorrow = new Date(Date.now() + 86400000).toLocaleString('en-CA', options).split(',')[0];

  logger.info(`[Collector] Dates: ${today} → ${tomorrow}`);

  // Fetch all fixtures for both days in 2 calls
  const [todayFixtures, tomorrowFixtures] = await Promise.all([
    fetchAllFixturesByDate(today),
    fetchAllFixturesByDate(tomorrow)
  ]);

  const allFixtures = [...todayFixtures, ...tomorrowFixtures];
  logger.info(`[Collector] ${allFixtures.length} matchs bruts récupérés (${todayFixtures.length} aujourd'hui + ${tomorrowFixtures.length} demain)`);

  if (allFixtures.length === 0) {
    logger.warn('[Collector] Aucun match trouvé depuis l\'API.');
    return [];
  }

  // ── Filter: only known leagues (score > 0) + not started ─────
  const eligibleFixtures = allFixtures
    .filter(f => {
      const score = getLeagueScore(f.league.id);
      const status = f.fixture.status.short;
      // Only collect matches NOT YET STARTED
      return score > 0 && ['NS', 'TBD'].includes(status);
    })
    .sort((a, b) => getLeagueScore(b.league.id) - getLeagueScore(a.league.id))
    .slice(0, 15); // Max 15 matchs par cycle

  logger.info(`[Collector] ${eligibleFixtures.length} matchs éligibles (ligues prioritaires, pas encore commencés)`);

  // ── Fetch stats + predictions + H2H for each match ─
  const allMatches = [];
  for (const fixture of eligibleFixtures) {
    const leagueScore = getLeagueScore(fixture.league.id);
    const match = await buildMatchObject(fixture, leagueScore);
    allMatches.push(match);

    const predInfo = match.api_predictions?.advice ? ` — API: "${match.api_predictions.advice}"` : '';
    const h2hInfo = match.h2h?.length ? ` — H2H: ${match.h2h.length} matchs` : '';
    logger.info(`  ✓ [${match.league_name}] ${match.home_team} vs ${match.away_team}${predInfo}${h2hInfo}`);

    await rateLimitPause(500); // Rate limit between enrichments (4 calls per match)
  }

  // Sort by kickoff time
  allMatches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  // ── Save to local cache (PRIMARY) ──────────────────
  await enrichMatchesWithTheOddsApi(allMatches);

  cacheWrite('matches', allMatches);

  // ── Try Firestore (SECONDARY, optional) ────────────
  await tryFirestoreSave(allMatches);

  logger.info(`[Collector] ✅ ${allMatches.length} matchs collectés et enrichis (predictions + H2H)`);
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
