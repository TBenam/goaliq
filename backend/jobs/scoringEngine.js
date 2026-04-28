/* ====================================================
   GOLIAT - Statistical Prediction Engine v4

   The engine predicts markets, not "a match".
   AI can explain the output, but the statistical core owns every decision.
   ==================================================== */

const DEFAULT_LEAGUE_HOME_GOALS = 1.43;
const DEFAULT_LEAGUE_AWAY_GOALS = 1.12;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function roundPct(value) {
  return round1(value * 100);
}

function safeNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) result *= lambda / i;
  return result;
}

function parseOdd(value) {
  const odd = Number.parseFloat(value);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function impliedProbabilityFromOdd(odd) {
  const parsed = parseOdd(odd);
  return parsed ? round1(100 / parsed) : null;
}

function fairOdds(prob) {
  return prob > 0 ? round2(100 / prob) : null;
}

function parseForm(form = '') {
  if (!form || typeof form !== 'string') return null;
  const chars = form.replace(/[^WDL]/gi, '').toUpperCase().split('').slice(-5);
  if (chars.length < 3) return null;

  const weights = [1, 1.5, 2, 2.5, 3];
  const startIdx = 5 - chars.length;
  let total = 0;
  let maxTotal = 0;

  chars.forEach((result, index) => {
    const weight = weights[startIdx + index];
    total += (result === 'W' ? 3 : result === 'D' ? 1 : 0) * weight;
    maxTotal += 3 * weight;
  });

  return Math.round((total / maxTotal) * 100);
}

function formMultiplier(score, side) {
  if (score === null) return 1;
  const delta = (score - 50) / 50;
  const maxSwing = side === 'attack' ? 0.1 : 0.08;
  return clamp(1 + delta * maxSwing, 0.88, 1.12);
}

function getLeagueAverages(match) {
  const home = safeNumber(match.league_home_goals_avg ?? match.average_league_home_goals, DEFAULT_LEAGUE_HOME_GOALS);
  const away = safeNumber(match.league_away_goals_avg ?? match.average_league_away_goals, DEFAULT_LEAGUE_AWAY_GOALS);
  return {
    home: clamp(home, 0.85, 2.35),
    away: clamp(away, 0.65, 1.95)
  };
}

function computeTeamStrengths(match, leagueAverages) {
  const homeGoals = safeNumber(match.home_goals_avg, leagueAverages.home);
  const awayGoals = safeNumber(match.away_goals_avg, leagueAverages.away);
  const homeConceded = safeNumber(match.home_goals_conceded, leagueAverages.away);
  const awayConceded = safeNumber(match.away_goals_conceded, leagueAverages.home);

  return {
    homeAttack: clamp(homeGoals / leagueAverages.home, 0.45, 2.2),
    awayAttack: clamp(awayGoals / leagueAverages.away, 0.45, 2.2),
    homeDefWeakness: clamp(homeConceded / leagueAverages.away, 0.45, 2.2),
    awayDefWeakness: clamp(awayConceded / leagueAverages.home, 0.45, 2.2)
  };
}

function computeContext(match, homeFormScore, awayFormScore) {
  const injuries = match.injuries || [];
  let homeInjuries = 0;
  let awayInjuries = 0;
  injuries.forEach(injury => {
    if (injury.team_id === match.home_team_id) homeInjuries++;
    if (injury.team_id === match.away_team_id) awayInjuries++;
  });

  const homeNext = match.home_next_match;
  const awayNext = match.away_next_match;
  const homeRest = Number(homeNext?.days_rest);
  const awayRest = Number(awayNext?.days_rest);
  const homeFatigue = Number.isFinite(homeRest) && homeRest > 0 && homeRest <= 4 ? 0.94 : 1;
  const awayFatigue = Number.isFinite(awayRest) && awayRest > 0 && awayRest <= 4 ? 0.94 : 1;

  const standings = match.standings || [];
  const homeStanding = standings.find(s => s.team_id === match.home_team_id);
  const awayStanding = standings.find(s => s.team_id === match.away_team_id);
  const motivationText = `${homeStanding?.description || ''} ${awayStanding?.description || ''}`.toLowerCase();
  const motivation = /relegation|promotion|champion|playoff|qualification/.test(motivationText) ? 1.04 : 1;

  const weatherPenalty = match.weather?.severity === 'high' || match.weather?.wind_kmh >= 35 || match.weather?.rain_mm >= 8
    ? 0.94
    : 1;

  return {
    homeForm: formMultiplier(homeFormScore, 'attack'),
    awayForm: formMultiplier(awayFormScore, 'attack'),
    homeFatigue,
    awayFatigue,
    homeInjuryAttack: clamp(1 - homeInjuries * 0.035, 0.82, 1),
    awayInjuryAttack: clamp(1 - awayInjuries * 0.035, 0.82, 1),
    homeInjuryDefenseLeak: clamp(1 + homeInjuries * 0.018, 1, 1.12),
    awayInjuryDefenseLeak: clamp(1 + awayInjuries * 0.018, 1, 1.12),
    motivation,
    weatherPenalty,
    homeInjuries,
    awayInjuries
  };
}

function computeLambdas(match, homeFormScore, awayFormScore) {
  const league = getLeagueAverages(match);
  const strengths = computeTeamStrengths(match, league);
  const context = computeContext(match, homeFormScore, awayFormScore);

  let homeLambda = league.home
    * strengths.homeAttack
    * strengths.awayDefWeakness
    * 1.08
    * context.homeForm
    * context.homeFatigue
    * context.homeInjuryAttack
    * context.awayInjuryDefenseLeak
    * context.motivation
    * context.weatherPenalty;

  let awayLambda = league.away
    * strengths.awayAttack
    * strengths.homeDefWeakness
    * context.awayForm
    * context.awayFatigue
    * context.awayInjuryAttack
    * context.homeInjuryDefenseLeak
    * context.motivation
    * context.weatherPenalty;

  if (match.xg_metrics) {
    const advancedHomeXg = safeNumber(match.xg_metrics.home_xg_for ?? match.xg_metrics.homeXg, null);
    const advancedAwayXg = safeNumber(match.xg_metrics.away_xg_for ?? match.xg_metrics.awayXg, null);
    if (advancedHomeXg && advancedHomeXg > 0) homeLambda = homeLambda * 0.45 + advancedHomeXg * 0.55;
    if (advancedAwayXg && advancedAwayXg > 0) awayLambda = awayLambda * 0.45 + advancedAwayXg * 0.55;
  }

  return {
    homeLambda: round2(clamp(homeLambda, 0.15, 4.2)),
    awayLambda: round2(clamp(awayLambda, 0.1, 3.8)),
    league,
    strengths,
    context
  };
}

function buildScoreMatrix(homeLambda, awayLambda, maxGoals = 8) {
  const matrix = [];
  const scoreRows = [];
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let under25 = 0;
  let under35 = 0;
  let bttsYes = 0;
  const exactScores = [];

  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    const pHome = poissonPmf(homeLambda, h);

    for (let a = 0; a <= maxGoals; a++) {
      const pAway = poissonPmf(awayLambda, a);
      const probability = pHome * pAway;
      const goals = h + a;
      matrix[h][a] = probability;

      if (h > a) homeWin += probability;
      if (h === a) draw += probability;
      if (a > h) awayWin += probability;
      if (goals >= 1) over05 += probability;
      if (goals >= 2) over15 += probability;
      if (goals >= 3) over25 += probability;
      if (goals >= 4) over35 += probability;
      if (goals <= 2) under25 += probability;
      if (goals <= 3) under35 += probability;
      if (h >= 1 && a >= 1) bttsYes += probability;

      exactScores.push({ home: h, away: a, prob: probability });
      scoreRows.push({ score: `${h}-${a}`, home: h, away: a, probability: roundPct(probability) });
    }
  }

  exactScores.sort((a, b) => b.prob - a.prob);

  return {
    matrix,
    scoreRows,
    homeWinProb: roundPct(homeWin),
    drawProb: roundPct(draw),
    awayWinProb: roundPct(awayWin),
    over05Prob: roundPct(over05),
    over15Prob: roundPct(over15),
    over25Prob: roundPct(over25),
    over35Prob: roundPct(over35),
    under25Prob: roundPct(under25),
    under35Prob: roundPct(under35),
    bttsProb: roundPct(bttsYes),
    bttsNoProb: roundPct(1 - bttsYes),
    topScores: exactScores.slice(0, 8).map(s => ({
      score: `${s.home}-${s.away}`,
      prob: roundPct(s.prob),
      probability: roundPct(s.prob)
    }))
  };
}

function getMarketOdd(marketType, odds = {}) {
  if (!odds) return null;

  const aliases = {
    home_win: ['home', 'home_win', '1'],
    draw: ['draw', 'x'],
    away_win: ['away', 'away_win', '2'],
    double_chance_1X: ['double_chance_1x', 'doubleChance1X', '1x'],
    double_chance_X2: ['double_chance_x2', 'doubleChanceX2', 'x2'],
    double_chance_12: ['double_chance_12', 'doubleChance12', '12'],
    over_15: ['over15', 'over_15', 'over1_5'],
    over_25: ['over25', 'over_25', 'over2_5'],
    over_35: ['over35', 'over_35', 'over3_5'],
    under_25: ['under25', 'under_25', 'under2_5'],
    under_35: ['under35', 'under_35', 'under3_5'],
    btts_yes: ['btts_yes', 'bttsYes'],
    btts_no: ['btts_no', 'bttsNo']
  };

  for (const key of aliases[marketType] || []) {
    const odd = parseOdd(odds[key]);
    if (odd) return odd;
  }

  const homeImp = impliedProbabilityFromOdd(odds.home);
  const drawImp = impliedProbabilityFromOdd(odds.draw);
  const awayImp = impliedProbabilityFromOdd(odds.away);
  if (marketType === 'double_chance_1X' && homeImp && drawImp) return round2(100 / Math.min(95, homeImp + drawImp));
  if (marketType === 'double_chance_X2' && awayImp && drawImp) return round2(100 / Math.min(95, awayImp + drawImp));
  if (marketType === 'double_chance_12' && homeImp && awayImp) return round2(100 / Math.min(95, homeImp + awayImp));
  return null;
}

function priceMarket(market, realOdds) {
  const bookmakerOdd = getMarketOdd(market.type, realOdds);
  const impliedProb = impliedProbabilityFromOdd(bookmakerOdd);
  const valueEdge = impliedProb ? round1(market.prob - impliedProb) : null;
  const valueScore = valueEdge === null ? 0 : clamp(valueEdge * 2.2, -25, 25);

  return {
    ...market,
    estimatedOdds: fairOdds(market.prob),
    fairOdds: fairOdds(market.prob),
    bookmakerOdd,
    impliedProb,
    valueEdge,
    valueScore,
    minRecommendedOdd: round2(100 / Math.max(1, market.prob - 2)),
    hasBookmakerPrice: bookmakerOdd !== null,
    valueLabel: valueEdge === null
      ? 'unpriced'
      : valueEdge >= 8
        ? 'strong_value'
        : valueEdge >= 3
          ? 'thin_value'
          : valueEdge <= -8
            ? 'bad_price'
            : 'fair_price'
  };
}

function buildMarkets(match, poisson, realOdds) {
  const marketDefs = [
    ['home_win', `Victoire ${match.home_team}`, poisson.homeWinProb, '1x2', 44],
    ['draw', 'Match nul', poisson.drawProb, '1x2', 28],
    ['away_win', `Victoire ${match.away_team}`, poisson.awayWinProb, '1x2', 42],
    ['double_chance_1X', `${match.home_team} ou Nul`, round1(poisson.homeWinProb + poisson.drawProb), 'double_chance', 62],
    ['double_chance_X2', `Nul ou ${match.away_team}`, round1(poisson.drawProb + poisson.awayWinProb), 'double_chance', 60],
    ['double_chance_12', `${match.home_team} ou ${match.away_team}`, round1(poisson.homeWinProb + poisson.awayWinProb), 'double_chance', 68],
    ['over_15', 'Plus de 1.5 buts', poisson.over15Prob, 'goals', 68],
    ['over_25', 'Plus de 2.5 buts', poisson.over25Prob, 'goals', 52],
    ['over_35', 'Plus de 3.5 buts', poisson.over35Prob, 'goals', 40],
    ['under_25', 'Moins de 2.5 buts', poisson.under25Prob, 'goals', 54],
    ['under_35', 'Moins de 3.5 buts', poisson.under35Prob, 'goals', 66],
    ['btts_yes', 'Les deux equipes marquent', poisson.bttsProb, 'btts', 52],
    ['btts_no', 'BTTS Non', poisson.bttsNoProb, 'btts', 56]
  ];

  return marketDefs
    .filter(([, , prob, , minProb]) => prob >= minProb)
    .map(([type, label, prob, family]) => priceMarket({
      type,
      label,
      prob: round1(prob),
      family,
      strength: prob >= 74 ? 'premium' : prob >= 64 ? 'strong' : prob >= 54 ? 'solid' : 'speculative'
    }, realOdds))
    .sort((a, b) => {
      const marketPriority = {
        double_chance_1X: 8,
        double_chance_X2: 8,
        over_15: 7,
        btts_yes: 6,
        home_win: 5,
        away_win: 5,
        over_25: 4,
        under_25: 2,
        btts_no: 1,
        under_35: -18,
        double_chance_12: -4,
        draw: -8,
        over_35: -6
      };
      const aScore = a.prob + a.valueScore + (marketPriority[a.type] || 0);
      const bScore = b.prob + b.valueScore + (marketPriority[b.type] || 0);
      return bScore - aScore;
    });
}

function isPrimaryMarketAllowed(market, poisson, totalXg) {
  if (!market || market.valueLabel === 'bad_price') return false;
  if (market.type === 'under_35') {
    return market.prob >= 84 && poisson.under25Prob >= 58 && totalXg <= 2.45 && market.valueEdge >= 3;
  }
  if (market.type === 'double_chance_12') return market.prob >= 76 && market.valueEdge >= 3;
  if (market.type === 'draw') return market.prob >= 34 && market.valueEdge >= 5;
  if (market.family === 'double_chance') return market.prob >= 68;
  if (market.type === 'over_15') return market.prob >= 72;
  if (market.type === 'under_25') return market.prob >= 62 || market.valueEdge >= 4;
  return market.prob >= 54;
}

function computeDataQuality({ formAvailable, apiPred, h2h, realOdds, injuries, standings, homeNext, awayNext, match }) {
  let score = 35;
  const components = [];

  if (formAvailable) { score += 18; components.push('form'); }
  if (apiPred) { score += 8; components.push('external_prediction'); }
  if (h2h.length >= 3) { score += 8; components.push('h2h'); }
  if (realOdds) { score += 14; components.push('bookmaker_odds'); }
  if (injuries.length > 0) { score += 6; components.push('injuries'); }
  if (standings.length > 0) { score += 5; components.push('standings'); }
  if (homeNext || awayNext) { score += 5; components.push('calendar'); }
  if (match.referee) { score += 2; components.push('referee'); }
  if (match.weather) { score += 3; components.push('weather'); }
  if (match.expected_lineups) { score += 5; components.push('expected_lineups'); }
  if (match.xg_metrics) { score += 8; components.push('advanced_xg'); }

  const finalScore = clamp(score, 0, 100);
  return {
    score: finalScore,
    level: finalScore >= 75 ? 'excellent' : finalScore >= 58 ? 'good' : finalScore >= 42 ? 'limited' : 'poor',
    components,
    missing: [
      !formAvailable ? 'form' : null,
      !realOdds ? 'bookmaker_odds' : null,
      h2h.length < 3 ? 'h2h' : null,
      injuries.length === 0 ? 'injuries' : null,
      standings.length === 0 ? 'standings' : null,
      !match.expected_lineups ? 'expected_lineups' : null,
      !match.xg_metrics ? 'advanced_xg' : null,
      !match.weather ? 'weather' : null
    ].filter(Boolean)
  };
}

function computeModelAgreement(scoringBase) {
  const { poisson, apiPred, bestMarket } = scoringBase;
  if (!apiPred || !bestMarket) return 58;

  const apiHome = safeNumber(apiPred.percent?.home, null);
  const apiDraw = safeNumber(apiPred.percent?.draw, null);
  const apiAway = safeNumber(apiPred.percent?.away, null);
  const modelByType = {
    home_win: poisson.homeWinProb,
    draw: poisson.drawProb,
    away_win: poisson.awayWinProb
  };
  const apiByType = {
    home_win: apiHome,
    draw: apiDraw,
    away_win: apiAway
  };

  if (modelByType[bestMarket.type] === undefined || apiByType[bestMarket.type] === null) return 62;
  const diff = Math.abs(modelByType[bestMarket.type] - apiByType[bestMarket.type]);
  return clamp(88 - diff * 1.7, 35, 90);
}

function computeIndices({ match, poisson, bestMarket, dataQuality, modelAgreement, context, h2h, formDelta }) {
  const valueIndex = bestMarket?.valueEdge === null || bestMarket?.valueEdge === undefined
    ? 50
    : clamp(50 + bestMarket.valueEdge * 3, 0, 100);

  const oddsValue = bestMarket?.valueEdge === null || bestMarket?.valueEdge === undefined
    ? 0.82
    : clamp(0.88 + bestMarket.valueEdge / 100, 0.72, 1.08);
  const marketConfirmation = bestMarket?.hasBookmakerPrice ? 0.98 : 0.9;
  const volatilityScore = clamp(
    (poisson.bttsProb >= 58 ? 14 : 0)
    + (poisson.over35Prob >= 38 ? 16 : 0)
    + (Math.abs(formDelta) <= 10 ? 8 : 0)
    + ((context.homeInjuries + context.awayInjuries) >= 4 ? 10 : 0)
    + ((match.referee || '').toLowerCase().includes('card') ? 6 : 0),
    0,
    100
  );

  const favoriteProb = Math.max(poisson.homeWinProb, poisson.awayWinProb);
  const favoriteOdd = poisson.homeWinProb >= poisson.awayWinProb
    ? parseOdd(match.bookmaker_odds?.home)
    : parseOdd(match.bookmaker_odds?.away);
  const impliedFavorite = impliedProbabilityFromOdd(favoriteOdd);
  const trapIndex = clamp(
    (impliedFavorite && impliedFavorite - favoriteProb > 8 ? 28 : 0)
    + (dataQuality.score < 50 ? 18 : 0)
    + (volatilityScore * 0.28)
    + ((h2h.length < 2) ? 8 : 0)
    + ((context.homeInjuries + context.awayInjuries) >= 5 ? 12 : 0),
    0,
    100
  );

  const riskScore = clamp(
    (100 - bestMarket?.prob) * 0.55
    + (100 - dataQuality.score) * 0.22
    + volatilityScore * 0.25
    + trapIndex * 0.22
    - (valueIndex - 50) * 0.12,
    0,
    100
  );

  const confidenceScore = Math.round(clamp(
    dataQuality.score * 0.28
    + modelAgreement * 0.2
    + marketConfirmation * 100 * 0.12
    + oddsValue * 100 * 0.12
    + (bestMarket?.prob || 0) * 0.35
    - riskScore * 0.17,
    0,
    100
  ));

  const finalScore = Math.round(clamp(
    confidenceScore
    + (valueIndex - 50) * 0.38
    + dataQuality.score * 0.18
    - riskScore * 0.3
    - volatilityScore * 0.18,
    0,
    100
  ));

  return {
    confidenceScore,
    confidence: confidenceScore >= 75 ? 'premium' : confidenceScore >= 65 ? 'high' : confidenceScore >= 50 ? 'medium' : 'low',
    confidenceLabel: confidenceScore >= 75 ? 'premium' : confidenceScore >= 65 ? 'solide' : confidenceScore >= 50 ? 'moyen' : 'faible',
    goalIqIndex: confidenceScore,
    trapIndex: Math.round(trapIndex),
    chaosIndex: Math.round(volatilityScore),
    valueIndex: Math.round(valueIndex),
    riskScore: Math.round(riskScore),
    finalScore
  };
}

function riskLabel(riskScore) {
  if (riskScore <= 34) return 'Faible';
  if (riskScore <= 58) return 'Moyen';
  return 'Eleve';
}

function marketCategory(market) {
  if (!market) return 'Value';
  if (market.family === 'double_chance' || (market.type === 'over_15' && market.prob >= 70)) return 'Safe';
  if (market.family === 'btts') return 'BTTS';
  if (market.valueLabel === 'strong_value' || market.valueLabel === 'thin_value') return 'Value';
  return market.prob >= 65 ? 'Safe' : 'Value';
}

function buildProductLayers({ markets, poisson, indices }) {
  const freeMarkets = markets
    .filter(m => ['double_chance_1X', 'double_chance_X2', 'over_15', 'btts_yes', 'home_win', 'away_win'].includes(m.type))
    .slice(0, 4);

  const vipMarkets = markets
    .filter(m => ['over_25', 'under_25', 'btts_yes', 'btts_no', 'home_win', 'away_win', 'over_35'].includes(m.type))
    .slice(0, 7);

  return {
    free: {
      markets: freeMarkets,
      confidence: indices.goalIqIndex,
      simplifiedRisk: riskLabel(indices.riskScore)
    },
    vip: {
      markets: vipMarkets,
      topScores: poisson.topScores.slice(0, 3),
      preferredScore: poisson.topScores[0] || null,
      prudentScore: poisson.topScores.find(s => s.score.includes('1-1') || s.score.includes('1-0') || s.score.includes('0-1')) || poisson.topScores[1] || null,
      chaosScore: poisson.topScores.find(s => {
        const [h, a] = s.score.split('-').map(Number);
        return h + a >= 4;
      }) || poisson.topScores[2] || null,
      valueMarkets: markets.filter(m => m.valueEdge >= 3).slice(0, 3)
    },
    pro: {
      scoreMatrix: poisson.scoreRows,
      indices,
      edgeMarkets: markets.filter(m => typeof m.valueEdge === 'number').sort((a, b) => b.valueEdge - a.valueEdge).slice(0, 5)
    }
  };
}

function marketExplanationSignals(match, scoring) {
  const signals = [];
  if (scoring.bestMarket) signals.push(`Marche moteur: ${scoring.bestMarket.label} (${scoring.bestMarket.prob}%)`);
  if (scoring.homeLambda >= 1.8) signals.push(`${match.home_team} projete haut a domicile (${scoring.homeLambda} xG)`);
  if (scoring.awayLambda >= 1.5) signals.push(`${match.away_team} projete dangereux a l'exterieur (${scoring.awayLambda} xG)`);
  if (scoring.poisson.over15Prob >= 72) signals.push(`Over 1.5 valide par la matrice (${scoring.poisson.over15Prob}%)`);
  if (scoring.poisson.bttsProb >= 58) signals.push(`BTTS en zone favorable (${scoring.poisson.bttsProb}%)`);
  if (scoring.bestMarket?.valueEdge >= 3) signals.push(`Value positive vs bookmaker (+${scoring.bestMarket.valueEdge} pts)`);
  return signals;
}

function computeAiPriorityScore({ confidenceScore, dataQuality, bestMarket, indices, match }) {
  return Math.round(clamp(
    confidenceScore * 0.42
    + dataQuality.score * 0.22
    + (bestMarket?.prob || 0) * 0.2
    + indices.valueIndex * 0.1
    + clamp((match.league_score || 0) / 10, 0, 10),
    0,
    100
  ));
}

export function scoreMatch(match, options = {}) {
  const signals = [];
  const warnings = [];
  const homeFormScore = parseForm(match.home_form);
  const awayFormScore = parseForm(match.away_form);
  const formAvailable = homeFormScore !== null && awayFormScore !== null;
  const formDelta = formAvailable ? homeFormScore - awayFormScore : 0;

  const lambdaInfo = computeLambdas(match, homeFormScore, awayFormScore);
  const poisson = buildScoreMatrix(lambdaInfo.homeLambda, lambdaInfo.awayLambda);
  const realOdds = match.bookmaker_odds || null;
  const markets = buildMarkets(match, poisson, realOdds);

  const h2h = match.h2h || [];
  const injuries = match.injuries || [];
  const standings = match.standings || [];
  const apiPred = match.api_predictions || null;
  const dataQuality = computeDataQuality({
    formAvailable,
    apiPred,
    h2h,
    realOdds,
    injuries,
    standings,
    homeNext: match.home_next_match,
    awayNext: match.away_next_match,
    match
  });

  const totalXg = round2(lambdaInfo.homeLambda + lambdaInfo.awayLambda);
  const bestMarket = markets.find(m => isPrimaryMarketAllowed(m, poisson, totalXg))
    || markets.find(m => m.valueLabel !== 'bad_price' && m.type !== 'under_35')
    || markets.find(m => m.valueLabel !== 'bad_price')
    || markets[0]
    || null;

  const modelAgreement = computeModelAgreement({ poisson, apiPred, bestMarket });
  const indices = computeIndices({
    match,
    poisson,
    bestMarket,
    dataQuality,
    modelAgreement,
    context: lambdaInfo.context,
    h2h,
    formDelta
  });

  if (!formAvailable) warnings.push('Forme recente non disponible - confiance reduite');
  if (!realOdds) warnings.push('Cotes bookmakers absentes - value bet non confirmee');
  if (dataQuality.score < 45) warnings.push(`Qualite de donnees limitee (${dataQuality.score}/100)`);
  if (indices.trapIndex >= 60) warnings.push(`Trap Index eleve (${indices.trapIndex}/100)`);
  if (indices.chaosIndex >= 55) warnings.push(`Chaos Index eleve (${indices.chaosIndex}/100)`);

  if (formAvailable && homeFormScore >= 70) signals.push(`${match.home_team} en forme (${homeFormScore}/100)`);
  if (formAvailable && awayFormScore >= 70) signals.push(`${match.away_team} en forme (${awayFormScore}/100)`);
  if (poisson.homeWinProb >= 52) signals.push(`${match.home_team} favori modele (${poisson.homeWinProb}%)`);
  if (poisson.awayWinProb >= 48) signals.push(`${match.away_team} favori modele (${poisson.awayWinProb}%)`);
  if (poisson.over25Prob >= 58) signals.push(`Over 2.5 favorable (${poisson.over25Prob}%)`);
  if (poisson.bttsProb >= 58) signals.push(`BTTS favorable (${poisson.bttsProb}%)`);
  if (bestMarket?.valueEdge >= 3) signals.push(`Value detectee: edge +${bestMarket.valueEdge} pts`);

  const qualityGate = {
    passed: false,
    reason: '',
    minConfidence: options.minConfidence ?? 35,
    minProb: options.minProb ?? 44,
    minDataQuality: options.minDataQuality ?? 25
  };

  if (!bestMarket) {
    qualityGate.reason = 'Aucun marche viable identifie';
  } else if (dataQuality.score < qualityGate.minDataQuality) {
    qualityGate.reason = `Donnees insuffisantes (${dataQuality.score} < ${qualityGate.minDataQuality})`;
  } else if (bestMarket.prob < qualityGate.minProb) {
    qualityGate.reason = `Probabilite trop faible (${bestMarket.prob}% < ${qualityGate.minProb}%)`;
  } else if (indices.confidenceScore < qualityGate.minConfidence) {
    qualityGate.reason = `Confiance insuffisante (${indices.confidenceScore} < ${qualityGate.minConfidence})`;
  } else if (indices.trapIndex >= 82) {
    qualityGate.reason = `Match piege (${indices.trapIndex}/100)`;
  } else if (bestMarket.valueLabel === 'bad_price') {
    qualityGate.reason = `Cote marche defavorable (${bestMarket.valueEdge} pts edge)`;
  } else {
    qualityGate.passed = true;
    qualityGate.reason = 'Tous les criteres statistiques satisfaits';
  }

  const productLayers = buildProductLayers({ markets, poisson, indices });
  const h2hSummary = h2h.length > 0 ? {
    total: h2h.length,
    homeWins: h2h.filter(m => (m.home_goals ?? 0) > (m.away_goals ?? 0)).length,
    draws: h2h.filter(m => (m.home_goals ?? 0) === (m.away_goals ?? 0)).length,
    awayWins: h2h.filter(m => (m.away_goals ?? 0) > (m.home_goals ?? 0)).length,
    avgGoals: round1(h2h.reduce((sum, m) => sum + (m.home_goals ?? 0) + (m.away_goals ?? 0), 0) / h2h.length)
  } : null;

  const scoringShell = {
    poisson,
    bestMarket,
    homeLambda: lambdaInfo.homeLambda,
    awayLambda: lambdaInfo.awayLambda
  };
  const extraSignals = marketExplanationSignals(match, { ...scoringShell, bestMarket });
  signals.push(...extraSignals.filter(s => !signals.includes(s)));

  const aiPriorityScore = computeAiPriorityScore({
    confidenceScore: indices.confidenceScore,
    dataQuality,
    bestMarket,
    indices,
    match
  });

  return {
    poisson,
    homeXg: lambdaInfo.homeLambda,
    awayXg: lambdaInfo.awayLambda,
    lambda_home: lambdaInfo.homeLambda,
    lambda_away: lambdaInfo.awayLambda,
    totalXg,
    leagueAverages: lambdaInfo.league,
    strengths: lambdaInfo.strengths,
    contextAdjustments: lambdaInfo.context,

    home_win_score: Math.round(poisson.homeWinProb),
    over25_prob: Math.round(poisson.over25Prob),
    btts_prob: Math.round(poisson.bttsProb),
    home_expected_goals: round1(lambdaInfo.homeLambda),
    away_expected_goals: round1(lambdaInfo.awayLambda),

    homeForm: homeFormScore,
    awayForm: awayFormScore,
    markets,
    bestMarket,
    productLayers,
    exactScoreRisk: 'Tres eleve',

    confidenceScore: indices.confidenceScore,
    confidence: indices.confidence,
    confidenceLabel: indices.confidenceLabel,
    qualityGate,
    dataQuality,
    modelAgreement,
    aiPriorityScore,
    finalScore: indices.finalScore,
    indices,
    riskScore: indices.riskScore,
    riskLabel: riskLabel(indices.riskScore),

    signals,
    warnings,
    apiPredictions: apiPred ? {
      homeProb: safeNumber(apiPred.percent?.home, null),
      drawProb: safeNumber(apiPred.percent?.draw, null),
      awayProb: safeNumber(apiPred.percent?.away, null),
      advice: apiPred.advice || null
    } : null,
    bookmakerOdds: realOdds,
    injuriesSummary: injuries.length > 0 ? {
      home: lambdaInfo.context.homeInjuries,
      away: lambdaInfo.context.awayInjuries,
      details: injuries
    } : null,
    standingsSummary: standings.length > 0 ? {
      homeRank: standings.find(s => s.team_id === match.home_team_id)?.rank || null,
      awayRank: standings.find(s => s.team_id === match.away_team_id)?.rank || null,
      homeDesc: standings.find(s => s.team_id === match.home_team_id)?.description || null,
      awayDesc: standings.find(s => s.team_id === match.away_team_id)?.description || null
    } : null,
    nextMatchSummary: {
      home: match.home_next_match || null,
      away: match.away_next_match || null
    },
    h2hSummary,
    topScores: poisson.topScores,
    recommendedCategory: marketCategory(bestMarket)
  };
}

export function rankMatchesByQuality(matches, options = {}) {
  return matches
    .map(match => ({ match, scoring: scoreMatch(match, options) }))
    .filter(({ scoring }) => scoring.qualityGate.passed)
    .sort((a, b) => {
      if (b.scoring.finalScore !== a.scoring.finalScore) return b.scoring.finalScore - a.scoring.finalScore;
      return b.scoring.confidenceScore - a.scoring.confidenceScore;
    });
}

function couponCorrelationPenalty(picks) {
  const families = picks.map(p => p.scoring_data?.bestMarket?.family || p.categorie);
  const repeated = families.length - new Set(families).size;
  return repeated * 0.04;
}

export function generateCoupons(pronos) {
  if (pronos.length < 2) return [];

  const eligible = [...pronos]
    .filter(p => !['Score Exact', 'Grosse Cote'].includes(p.categorie))
    .filter(p => (p.scoring_data?.indices?.chaosIndex || 0) < 62)
    .sort((a, b) => (b.scoring_data?.finalScore || b.fiabilite || 0) - (a.scoring_data?.finalScore || a.fiabilite || 0));

  const buildCoupon = (title, picks, index) => {
    if (picks.length < 2) return null;
    const rawProb = picks.reduce((acc, pick) => acc * ((pick.fiabilite || 50) / 100), 1);
    const adjustedProb = clamp(rawProb - couponCorrelationPenalty(picks), 0.05, 0.78);
    const totalOdds = round2(picks.reduce((acc, pick) => acc * (parseOdd(pick.cote) || 1.35), 1));

    return {
      id: `coupon_${Date.now()}_${index}`,
      title,
      description: 'Combine optimise par probabilite, volatilite et correlation faible.',
      type: 'combine',
      matches: picks.map(p => ({
        match: p.match,
        prono: p.prono,
        cote: p.cote,
        probability: p.fiabilite,
        risk: p.risque
      })),
      totalOdds,
      probability: Math.round(adjustedProb * 100),
      fiabilite: Math.round(adjustedProb * 100),
      risk_notice: 'Un combine safe reste risque: les probabilites se multiplient.',
      is_vip: true
    };
  };

  return [
    buildCoupon('Duo Safe GOLIAT', eligible.slice(0, 2), 1),
    buildCoupon('Triple Controle VIP', [eligible[0], eligible[2], eligible[3]].filter(Boolean), 2)
  ].filter(Boolean);
}
