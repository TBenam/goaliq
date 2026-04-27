import axios from 'axios';
import { logger } from '../utils/logger.js';

const BASE_URL = 'https://api.the-odds-api.com/v4';
const DEFAULT_REGION = 'eu';
const DEFAULT_MARKETS = 'h2h';
const DEFAULT_CACHE_TTL_MS = 6 * 3600 * 1000;

const LEAGUE_TO_SPORT_KEY = {
  2: 'soccer_uefa_champs_league',
  3: 'soccer_uefa_europa_league',
  39: 'soccer_epl',
  61: 'soccer_france_ligue_one',
  78: 'soccer_germany_bundesliga',
  88: 'soccer_netherlands_eredivisie',
  94: 'soccer_portugal_primeira_liga',
  135: 'soccer_italy_serie_a',
  140: 'soccer_spain_la_liga',
  179: 'soccer_spl',
  253: 'soccer_usa_mls',
  848: 'soccer_uefa_europa_conference_league'
};

const memoryCache = new Map();

function getApiKey() {
  return process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY || null;
}

function getRegions() {
  return process.env.THE_ODDS_API_REGIONS || DEFAULT_REGION;
}

function getMarkets() {
  return process.env.THE_ODDS_API_MARKETS || DEFAULT_MARKETS;
}

function getCacheTtlMs() {
  const hours = Number.parseFloat(process.env.THE_ODDS_API_CACHE_HOURS || '6');
  return Number.isFinite(hours) && hours > 0 ? hours * 3600 * 1000 : DEFAULT_CACHE_TTL_MS;
}

export function getSportKeyForLeague(leagueId) {
  return LEAGUE_TO_SPORT_KEY[Number(leagueId)] || null;
}

export function getMaxSportKeysPerRun() {
  const parsed = Number.parseInt(process.env.THE_ODDS_API_MAX_SPORTS_PER_RUN || '4', 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 12 ? parsed : 4;
}

function normalizeTeamName(name = '') {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|sc|afc|club|de|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenOverlapScore(a = '', b = '') {
  const aTokens = new Set(normalizeTeamName(a).split(' ').filter(Boolean));
  const bTokens = new Set(normalizeTeamName(b).split(' ').filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;

  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared++;
  }

  return shared / Math.max(aTokens.size, bTokens.size);
}

function sameKickoffWindow(a, b, maxHours = 8) {
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Number.isFinite(diff) && diff <= maxHours * 3600 * 1000;
}

function average(values) {
  const clean = values.filter(v => Number.isFinite(v) && v > 1);
  if (!clean.length) return null;
  return Math.round((clean.reduce((sum, v) => sum + v, 0) / clean.length) * 100) / 100;
}

function pickH2HMarket(bookmaker) {
  return bookmaker.markets?.find(m => m.key === 'h2h') || null;
}

function buildConsensusOdds(event, match) {
  const homePrices = [];
  const drawPrices = [];
  const awayPrices = [];
  const bookmakers = [];

  for (const bookmaker of event.bookmakers || []) {
    const h2h = pickH2HMarket(bookmaker);
    if (!h2h) continue;

    const homeOutcome = h2h.outcomes?.find(o => tokenOverlapScore(o.name, match.home_team) >= 0.5);
    const awayOutcome = h2h.outcomes?.find(o => tokenOverlapScore(o.name, match.away_team) >= 0.5);
    const drawOutcome = h2h.outcomes?.find(o => normalizeTeamName(o.name) === 'draw');

    if (homeOutcome?.price) homePrices.push(Number(homeOutcome.price));
    if (drawOutcome?.price) drawPrices.push(Number(drawOutcome.price));
    if (awayOutcome?.price) awayPrices.push(Number(awayOutcome.price));

    bookmakers.push({
      key: bookmaker.key,
      title: bookmaker.title,
      last_update: bookmaker.last_update,
      home: homeOutcome?.price || null,
      draw: drawOutcome?.price || null,
      away: awayOutcome?.price || null
    });
  }

  const home = average(homePrices);
  const draw = average(drawPrices);
  const away = average(awayPrices);
  if (!home && !draw && !away) return null;

  return {
    home,
    draw,
    away,
    provider: 'the-odds-api',
    sport_key: event.sport_key,
    event_id: event.id,
    bookmaker_count: bookmakers.length,
    bookmakers,
    opening: null,
    closing: null,
    movement: null,
    fetched_at: new Date().toISOString()
  };
}

export function matchOddsEvent(match, events = []) {
  let best = null;

  for (const event of events) {
    if (!sameKickoffWindow(match.kickoff, event.commence_time)) continue;

    const directScore =
      tokenOverlapScore(match.home_team, event.home_team) +
      tokenOverlapScore(match.away_team, event.away_team);
    const reversedScore =
      tokenOverlapScore(match.home_team, event.away_team) +
      tokenOverlapScore(match.away_team, event.home_team);
    const score = Math.max(directScore, reversedScore);

    if (score >= 1.2 && (!best || score > best.score)) {
      best = { event, score };
    }
  }

  return best?.event || null;
}

export async function fetchOddsEventsForSport(sportKey, { commenceTimeFrom, commenceTimeTo } = {}) {
  const apiKey = getApiKey();
  if (!apiKey || !sportKey) return [];

  const cacheKey = JSON.stringify({
    sportKey,
    regions: getRegions(),
    markets: getMarkets(),
    commenceTimeFrom,
    commenceTimeTo
  });
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < getCacheTtlMs()) {
    return cached.events;
  }

  try {
    const { data, headers } = await axios.get(`${BASE_URL}/sports/${sportKey}/odds`, {
      timeout: 12000,
      params: {
        apiKey,
        regions: getRegions(),
        markets: getMarkets(),
        oddsFormat: 'decimal',
        dateFormat: 'iso',
        commenceTimeFrom,
        commenceTimeTo
      }
    });

    const events = Array.isArray(data) ? data : [];
    memoryCache.set(cacheKey, { events, createdAt: Date.now() });

    logger.info(
      `[TheOddsAPI] ${sportKey}: ${events.length} events, credits last=${headers['x-requests-last'] || '?'}, remaining=${headers['x-requests-remaining'] || '?'}`
    );

    return events;
  } catch (err) {
    logger.warn(`[TheOddsAPI] Echec ${sportKey}: ${err.response?.status || ''} ${err.message}`);
    return [];
  }
}

export function extractConsensusOdds(match, events = []) {
  const event = matchOddsEvent(match, events);
  return event ? buildConsensusOdds(event, match) : null;
}
