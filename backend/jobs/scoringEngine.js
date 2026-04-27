/* ====================================================
   GOLIAT — Scoring Engine v3
   Architecture Poisson + Multi-Signal + Quality Gate

   Chaque match est évalué sur 7 dimensions indépendantes.
   Un prono n'est publié QUE s'il franchit le seuil de qualité.
   ==================================================== */

// ── Poisson Distribution ─────────────────────────────
// P(X = k) = (λ^k * e^(-λ)) / k!
function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    result *= lambda / i;
  }
  return result;
}

/**
 * Build a full score matrix from two lambda values (xG).
 * Returns probabilities for home win, draw, away win,
 * over/under, BTTS, and exact score predictions.
 */
function buildScoreMatrix(homeLambda, awayLambda, maxGoals = 6) {
  const matrix = [];
  let homeWin = 0, draw = 0, awayWin = 0;
  let over15 = 0, over25 = 0, over35 = 0;
  let bttsYes = 0;
  const exactScores = [];

  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    const pH = poissonPmf(homeLambda, h);
    for (let a = 0; a <= maxGoals; a++) {
      const pA = poissonPmf(awayLambda, a);
      const p = pH * pA;
      matrix[h][a] = p;

      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;

      if (h + a > 1.5) over15 += p;
      if (h + a > 2.5) over25 += p;
      if (h + a > 3.5) over35 += p;
      if (h > 0 && a > 0) bttsYes += p;

      exactScores.push({ home: h, away: a, prob: p });
    }
  }

  exactScores.sort((a, b) => b.prob - a.prob);

  return {
    matrix,
    homeWinProb: Math.round(homeWin * 100),
    drawProb: Math.round(draw * 100),
    awayWinProb: Math.round(awayWin * 100),
    over15Prob: Math.round(over15 * 100),
    over25Prob: Math.round(over25 * 100),
    over35Prob: Math.round(over35 * 100),
    bttsProb: Math.round(bttsYes * 100),
    topScores: exactScores.slice(0, 5).map(s => ({
      score: `${s.home}-${s.away}`,
      prob: Math.round(s.prob * 1000) / 10  // one decimal %
    }))
  };
}

// ── Form Parser ──────────────────────────────────────
// Parse "WWLDW" → weighted score 0-100 (recent = heavier)
function parseForm(form = '') {
  if (!form || typeof form !== 'string') return null;
  const chars = form.replace(/[^WDL]/gi, '').toUpperCase().split('').slice(-5);
  if (chars.length < 3) return null; // Need at least 3 results

  const weights = [1, 1.5, 2, 2.5, 3]; // Most recent = weight 3
  const startIdx = 5 - chars.length;
  let total = 0, maxTotal = 0;

  chars.forEach((r, i) => {
    const w = weights[startIdx + i];
    total += (r === 'W' ? 3 : r === 'D' ? 1 : 0) * w;
    maxTotal += 3 * w;
  });

  return Math.round((total / maxTotal) * 100);
}

// ── Calculate xG from attack and defense stats ───────
function calcXg(attackAvg, defenseAvg, isHome = false) {
  // xG = average of (team's attacking power + opponent's defensive weakness)
  // Home advantage adds ~0.25 goals (well-established in football analytics)
  const base = (parseFloat(attackAvg || 1.1) + parseFloat(defenseAvg || 1.2)) / 2;
  return isHome ? base + 0.25 : base;
}

// ── Evaluate edge: how much do markets deviate? ──────
function evaluateValueEdge(ourProb, impliedProb) {
  if (!ourProb || !impliedProb || impliedProb <= 0) return 0;
  return ((ourProb - impliedProb) / impliedProb) * 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseOdd(value) {
  const odd = Number.parseFloat(value);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function impliedProbabilityFromOdd(odd) {
  const parsed = parseOdd(odd);
  return parsed ? round1(100 / parsed) : null;
}

function getMarketOdd(marketType, odds = {}) {
  if (!odds) return null;

  const aliases = {
    home_win: ['home', 'home_win', '1'],
    draw: ['draw', 'x'],
    away_win: ['away', 'away_win', '2'],
    double_chance_1X: ['double_chance_1x', 'doubleChance1X', '1x'],
    double_chance_X2: ['double_chance_x2', 'doubleChanceX2', 'x2'],
    over_15: ['over15', 'over_15', 'over1_5'],
    over_25: ['over25', 'over_25', 'over2_5'],
    under_25: ['under25', 'under_25', 'under2_5'],
    btts_yes: ['btts_yes', 'bttsYes'],
    btts_no: ['btts_no', 'bttsNo']
  };

  for (const key of aliases[marketType] || []) {
    const odd = parseOdd(odds[key]);
    if (odd) return odd;
  }

  // Approximation useful until a richer odds provider is connected.
  if (marketType === 'double_chance_1X') {
    const home = impliedProbabilityFromOdd(odds.home);
    const draw = impliedProbabilityFromOdd(odds.draw);
    return home && draw ? round2(100 / Math.min(95, home + draw)) : null;
  }

  if (marketType === 'double_chance_X2') {
    const away = impliedProbabilityFromOdd(odds.away);
    const draw = impliedProbabilityFromOdd(odds.draw);
    return away && draw ? round2(100 / Math.min(95, away + draw)) : null;
  }

  return null;
}

function enrichMarketWithPricing(market, realOdds) {
  const bookmakerOdd = getMarketOdd(market.type, realOdds);
  const impliedProb = impliedProbabilityFromOdd(bookmakerOdd);
  const valueEdge = impliedProb ? round1(evaluateValueEdge(market.prob, impliedProb)) : null;

  return {
    ...market,
    fairOdds: market.estimatedOdds,
    bookmakerOdd,
    impliedProb,
    valueEdge,
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

function computeDataQuality({ formAvailable, apiPred, h2h, realOdds, injuries, standings, homeNext, awayNext, match }) {
  let score = 35;
  const components = [];

  if (formAvailable) { score += 18; components.push('form'); }
  if (apiPred) { score += 14; components.push('api_prediction'); }
  if (h2h.length >= 3) { score += 8; components.push('h2h'); }
  if (realOdds) { score += 12; components.push('bookmaker_odds'); }
  if (injuries.length > 0) { score += 6; components.push('injuries'); }
  if (standings.length > 0) { score += 5; components.push('standings'); }
  if (homeNext || awayNext) { score += 5; components.push('calendar'); }
  if (match.referee) { score += 2; components.push('referee'); }
  if (match.weather) { score += 3; components.push('weather'); }
  if (match.expected_lineups) { score += 5; components.push('expected_lineups'); }
  if (match.xg_metrics) { score += 8; components.push('advanced_xg'); }

  return {
    score: clamp(score, 0, 100),
    level: score >= 75 ? 'excellent' : score >= 58 ? 'good' : score >= 42 ? 'limited' : 'poor',
    components,
    missing: [
      !formAvailable ? 'form' : null,
      !apiPred ? 'api_prediction' : null,
      h2h.length < 3 ? 'h2h' : null,
      !realOdds ? 'bookmaker_odds' : null,
      injuries.length === 0 ? 'injuries' : null,
      standings.length === 0 ? 'standings' : null,
      !match.expected_lineups ? 'expected_lineups' : null,
      !match.xg_metrics ? 'advanced_xg' : null,
      !match.weather ? 'weather' : null
    ].filter(Boolean)
  };
}

function computeAiPriorityScore({ scoring, match }) {
  const best = scoring.bestMarket;
  const valueBonus = typeof best?.valueEdge === 'number'
    ? clamp(best.valueEdge, -10, 18)
    : 0;
  const contradictionBonus = scoring.warnings.length >= 2 ? 8 : 0;
  const leagueBonus = clamp((match.league_score || 0) / 10, 0, 10);

  return Math.round(
    scoring.confidenceScore * 0.38 +
    scoring.dataQuality.score * 0.24 +
    (best?.prob || 0) * 0.22 +
    valueBonus * 0.7 +
    contradictionBonus +
    leagueBonus
  );
}

/**
 * ══════════════════════════════════════════════════════
 * MAIN SCORING FUNCTION v3
 * ══════════════════════════════════════════════════════
 *
 * Input:  match object from collectMatches.js (enriched)
 * Output: comprehensive scoring with quality gate
 */
export function scoreMatch(match) {
  const signals = [];
  const warnings = [];

  // ── 1. Calculate xG using Poisson inputs ──────────
  const homeAtt = parseFloat(match.home_goals_avg || 1.1);
  const awayAtt = parseFloat(match.away_goals_avg || 1.0);
  const homeDef = parseFloat(match.home_goals_conceded || 1.2);
  const awayDef = parseFloat(match.away_goals_conceded || 1.2);

  let homeXg = calcXg(homeAtt, awayDef, true);   // Home attacks vs Away defense
  let awayXg = calcXg(awayAtt, homeDef, false);   // Away attacks vs Home defense

  if (match.xg_metrics) {
    const advancedHomeXg = parseFloat(match.xg_metrics.home_xg_for ?? match.xg_metrics.homeXg);
    const advancedAwayXg = parseFloat(match.xg_metrics.away_xg_for ?? match.xg_metrics.awayXg);
    if (Number.isFinite(advancedHomeXg) && advancedHomeXg > 0) homeXg = advancedHomeXg;
    if (Number.isFinite(advancedAwayXg) && advancedAwayXg > 0) awayXg = advancedAwayXg;
    signals.push('xG avance disponible');
  }

  // ── 2. Poisson Score Matrix ───────────────────────
  const poisson = buildScoreMatrix(homeXg, awayXg);

  // ── 3. Form Analysis ──────────────────────────────
  const homeFormScore = parseForm(match.home_form);
  const awayFormScore = parseForm(match.away_form);
  const formAvailable = homeFormScore !== null && awayFormScore !== null;

  let formDelta = 0;
  if (formAvailable) {
    formDelta = homeFormScore - awayFormScore;
    if (homeFormScore >= 75) signals.push(`Domicile en grande forme (${homeFormScore}%)`);
    if (awayFormScore >= 75) signals.push(`Extérieur en grande forme (${awayFormScore}%)`);
    if (homeFormScore <= 25) warnings.push(`Domicile en crise (${homeFormScore}%)`);
    if (awayFormScore <= 25) warnings.push(`Extérieur en crise (${awayFormScore}%)`);
  } else {
    warnings.push('Forme récente non disponible — confiance réduite');
  }

  // ── 4. API-Football Predictions (if available) ────
  const apiPred = match.api_predictions || null;
  let apiHomeProb = null, apiDrawProb = null, apiAwayProb = null;
  let apiAdvice = null;

  if (apiPred) {
    apiHomeProb = parseFloat(apiPred.percent?.home) || null;
    apiDrawProb = parseFloat(apiPred.percent?.draw) || null;
    apiAwayProb = parseFloat(apiPred.percent?.away) || null;
    apiAdvice = apiPred.advice || null;
    if (apiAdvice) signals.push(`API-Football: "${apiAdvice}"`);
  }

  // ── 4b. Injuries & Suspensions (Absences) ─────────
  const injuries = match.injuries || [];
  let homeInjuries = 0, awayInjuries = 0;
  if (injuries.length > 0) {
    injuries.forEach(inj => {
      if (inj.team_id === match.home_team_id) homeInjuries++;
      if (inj.team_id === match.away_team_id) awayInjuries++;
    });
    if (homeInjuries >= 3) warnings.push(`Domicile très diminué (${homeInjuries} joueurs absents)`);
    else if (homeInjuries > 0) warnings.push(`Domicile: ${homeInjuries} absent(s)`);
    
    if (awayInjuries >= 3) signals.push(`Extérieur très diminué (${awayInjuries} joueurs absents)`);
    else if (awayInjuries > 0) signals.push(`Extérieur: ${awayInjuries} absent(s)`);
  }

  // ── 4c. Market Sentiment (Bookmaker Odds) ─────────
  const realOdds = match.bookmaker_odds || null;
  if (realOdds && poisson.homeWinProb > 0) {
    const poissonImpliedHomeOdds = 100 / poisson.homeWinProb;
    // Si la cote réelle est BEAUCOUP plus basse que notre cote Poisson, c'est du Smart Money
    if (realOdds.home < poissonImpliedHomeOdds * 0.8) {
      signals.push(`Smart Money détecté sur Victoire Domicile (Cote réelle @${realOdds.home} vs Poisson @${poissonImpliedHomeOdds.toFixed(2)})`);
    }
    const poissonImpliedAwayOdds = 100 / poisson.awayWinProb;
    if (realOdds.away < poissonImpliedAwayOdds * 0.8) {
      warnings.push(`Smart Money détecté sur Victoire Extérieur (Cote réelle @${realOdds.away} vs Poisson @${poissonImpliedAwayOdds.toFixed(2)})`);
    }
  }

  // ── 4d. Stakes & Standings (Enjeu mathématique) ───
  const standings = match.standings || [];
  let homeRank = null, awayRank = null;
  let homeDesc = null, awayDesc = null;

  if (standings.length > 0) {
    const homeSt = standings.find(s => s.team_id === match.home_team_id);
    const awaySt = standings.find(s => s.team_id === match.away_team_id);
    if (homeSt) { homeRank = homeSt.rank; homeDesc = homeSt.description; }
    if (awaySt) { awayRank = awaySt.rank; awayDesc = awaySt.description; }

    if (homeDesc && homeDesc.toLowerCase().includes('relegation')) signals.push(`Enjeu critique: Domicile joue le maintien`);
    else if (homeDesc && (homeDesc.toLowerCase().includes('champion') || homeDesc.toLowerCase().includes('promotion'))) signals.push(`Enjeu majeur: Domicile joue le haut de tableau`);

    if (awayDesc && awayDesc.toLowerCase().includes('relegation')) signals.push(`Enjeu critique: Extérieur joue le maintien`);
    else if (awayDesc && (awayDesc.toLowerCase().includes('champion') || awayDesc.toLowerCase().includes('promotion'))) signals.push(`Enjeu majeur: Extérieur joue le haut de tableau`);
  }

  // ── 4e. Fatigue & Rotation Risk ────────────────────
  const homeNext = match.home_next_match;
  const awayNext = match.away_next_match;
  let homeFatiguePenalty = 0;
  let awayFatiguePenalty = 0;

  if (homeNext && homeNext.days_rest <= 4 && homeNext.days_rest > 0) {
    const isBigMatch = homeNext.competition.toLowerCase().includes('champion') || homeNext.competition.toLowerCase().includes('europa') || homeNext.competition.toLowerCase().includes('cup');
    if (isBigMatch) {
      warnings.push(`Rotation Domicile: Match crucial (${homeNext.competition}) dans ${homeNext.days_rest} jours`);
      homeFatiguePenalty = 20;
    } else {
      warnings.push(`Calendrier chargé Domicile: Prochain match dans ${homeNext.days_rest} jours`);
      homeFatiguePenalty = 5;
    }
  }

  if (awayNext && awayNext.days_rest <= 4 && awayNext.days_rest > 0) {
    const isBigMatch = awayNext.competition.toLowerCase().includes('champion') || awayNext.competition.toLowerCase().includes('europa') || awayNext.competition.toLowerCase().includes('cup');
    if (isBigMatch) {
      warnings.push(`Rotation Extérieur: Match crucial (${awayNext.competition}) dans ${awayNext.days_rest} jours`);
      awayFatiguePenalty = 20;
    } else {
      warnings.push(`Calendrier chargé Extérieur: Prochain match dans ${awayNext.days_rest} jours`);
      awayFatiguePenalty = 5;
    }
  }

  // ── 5. H2H Analysis ──────────────────────────────
  const h2h = match.h2h || [];
  let h2hHomeWins = 0, h2hAwayWins = 0, h2hDraws = 0, h2hTotalGoals = 0;
  if (h2h.length > 0) {
    h2h.forEach(m => {
      const hGoals = m.home_goals ?? 0;
      const aGoals = m.away_goals ?? 0;
      h2hTotalGoals += hGoals + aGoals;
      if (hGoals > aGoals) h2hHomeWins++;
      else if (aGoals > hGoals) h2hAwayWins++;
      else h2hDraws++;
    });
    const h2hAvgGoals = h2hTotalGoals / h2h.length;
    if (h2hAvgGoals >= 3.0) signals.push(`H2H: ${h2hAvgGoals.toFixed(1)} buts/match en moyenne`);
    if (h2hHomeWins >= 3) signals.push(`H2H: Domicile domine (${h2hHomeWins}V/${h2h.length})`);
    if (h2hAwayWins >= 3) signals.push(`H2H: Extérieur domine (${h2hAwayWins}V/${h2h.length})`);
  }

  // ── 6. Compute Composite Score (0-100) ────────────
  // Base: Poisson probability mapped to 0-100
  const dataQuality = computeDataQuality({
    formAvailable,
    apiPred,
    h2h,
    realOdds,
    injuries,
    standings,
    homeNext,
    awayNext,
    match
  });

  if (dataQuality.level === 'poor') {
    warnings.push(`Qualite de donnees faible (${dataQuality.score}/100)`);
  }

  let compositeScore = poisson.homeWinProb;

  // Adjust with form if available (max ±15 points)
  if (formAvailable) {
    compositeScore += Math.max(-15, Math.min(15, formDelta * 0.20));
  }

  // Adjust with API-Football predictions if available (max ±10 points)
  if (apiHomeProb !== null) {
    const apiDelta = apiHomeProb - compositeScore;
    compositeScore += Math.max(-10, Math.min(10, apiDelta * 0.3));
  }

  compositeScore = Math.max(5, Math.min(95, Math.round(compositeScore)));

  // ── 7. Market Detection: find the BEST bet ────────
  const markets = [];

  // 7a. Home Win
  if (poisson.homeWinProb >= 50) {
    markets.push({
      type: 'home_win',
      label: `Victoire ${match.home_team}`,
      prob: poisson.homeWinProb,
      estimatedOdds: Math.round((100 / poisson.homeWinProb) * 100) / 100,
      strength: poisson.homeWinProb >= 60 ? 'strong' : 'moderate'
    });
  }

  // 7b. Away Win
  if (poisson.awayWinProb >= 45) {
    markets.push({
      type: 'away_win',
      label: `Victoire ${match.away_team}`,
      prob: poisson.awayWinProb,
      estimatedOdds: Math.round((100 / poisson.awayWinProb) * 100) / 100,
      strength: poisson.awayWinProb >= 55 ? 'strong' : 'moderate'
    });
  }

  // 7c. Double Chance Home
  if (poisson.homeWinProb + poisson.drawProb >= 65) {
    markets.push({
      type: 'double_chance_1X',
      label: `${match.home_team} ou Nul`,
      prob: poisson.homeWinProb + poisson.drawProb,
      estimatedOdds: Math.round((100 / (poisson.homeWinProb + poisson.drawProb)) * 100) / 100,
      strength: (poisson.homeWinProb + poisson.drawProb) >= 75 ? 'strong' : 'moderate'
    });
  }

  // 7d. Double Chance Away
  if (poisson.awayWinProb + poisson.drawProb >= 60) {
    markets.push({
      type: 'double_chance_X2',
      label: `Nul ou ${match.away_team}`,
      prob: poisson.awayWinProb + poisson.drawProb,
      estimatedOdds: Math.round((100 / (poisson.awayWinProb + poisson.drawProb)) * 100) / 100,
      strength: (poisson.awayWinProb + poisson.drawProb) >= 70 ? 'strong' : 'moderate'
    });
  }

  // 7e. Over 2.5
  if (poisson.over25Prob >= 55) {
    markets.push({
      type: 'over_25',
      label: 'Plus de 2.5 buts',
      prob: poisson.over25Prob,
      estimatedOdds: Math.round((100 / poisson.over25Prob) * 100) / 100,
      strength: poisson.over25Prob >= 65 ? 'strong' : 'moderate'
    });
  }

  // 7f. Under 2.5
  if ((100 - poisson.over25Prob) >= 60) {
    markets.push({
      type: 'under_25',
      label: 'Moins de 2.5 buts',
      prob: 100 - poisson.over25Prob,
      estimatedOdds: Math.round((100 / (100 - poisson.over25Prob)) * 100) / 100,
      strength: (100 - poisson.over25Prob) >= 70 ? 'strong' : 'moderate'
    });
  }

  // 7g. BTTS Yes
  if (poisson.bttsProb >= 55) {
    markets.push({
      type: 'btts_yes',
      label: 'Les deux équipes marquent',
      prob: poisson.bttsProb,
      estimatedOdds: Math.round((100 / poisson.bttsProb) * 100) / 100,
      strength: poisson.bttsProb >= 65 ? 'strong' : 'moderate'
    });
  }

  // 7h. BTTS No
  if ((100 - poisson.bttsProb) >= 60) {
    markets.push({
      type: 'btts_no',
      label: 'Au moins une équipe ne marque pas',
      prob: 100 - poisson.bttsProb,
      estimatedOdds: Math.round((100 / (100 - poisson.bttsProb)) * 100) / 100,
      strength: (100 - poisson.bttsProb) >= 70 ? 'strong' : 'moderate'
    });
  }

  // 7i. Over 1.5
  if (poisson.over15Prob >= 75) {
    markets.push({
      type: 'over_15',
      label: 'Plus de 1.5 buts',
      prob: poisson.over15Prob,
      estimatedOdds: Math.round((100 / poisson.over15Prob) * 100) / 100,
      strength: poisson.over15Prob >= 85 ? 'strong' : 'moderate'
    });
  }

  const pricedMarkets = markets
    .map(m => enrichMarketWithPricing(m, realOdds))
    .sort((a, b) => {
      // Priority 1: Smart Money / Strong Value
      const aVal = a.valueLabel === 'strong_value' ? 10 : 0;
      const bVal = b.valueLabel === 'strong_value' ? 10 : 0;
      if (aVal !== bVal) return bVal - aVal;

      // Priority 2: Avoid bad prices
      const aBad = a.valueLabel === 'bad_price' ? -10 : 0;
      const bBad = b.valueLabel === 'bad_price' ? -10 : 0;
      if (aBad !== bBad) return bBad - aBad;

      // Priority 3: Balanced probability vs Odds (Value)
      // We want high prob but also attractive odds.
      const aScore = a.prob * (a.bookmakerOdd || a.estimatedOdds);
      const bScore = b.prob * (b.bookmakerOdd || b.estimatedOdds);
      return bScore - aScore;
    });

  // Sort by probability descending for legacy consumers.
  markets.sort((a, b) => b.prob - a.prob);

  // ── 8. Best Market Selection ──────────────────────
  // Favor Straight Wins (1 or 2) over Double Chance if probability is solid (>52%)
  // or if the odds are much more attractive (>1.65)
  const bestMarket = pricedMarkets.find(m => {
    const isStraight = ['home_win', 'away_win'].includes(m.type);
    const isDC = m.type.startsWith('double_chance');
    const odds = m.bookmakerOdd || m.estimatedOdds;

    if (isStraight && m.prob >= 52) return true;
    if (isStraight && odds >= 1.75 && m.prob >= 48) return true;
    if (!isDC && m.prob >= 55) return true; // Over/Under/BTTS
    return false;
  }) || pricedMarkets.find(m => (m.bookmakerOdd || m.estimatedOdds) >= 1.30) || pricedMarkets[0] || null;

  // ── 9. Compute Confidence Level ───────────────────
  let confidenceScore = 0;

  // 9a. Poisson clarity: big gap between best and 2nd best outcome
  const outcomes = [poisson.homeWinProb, poisson.drawProb, poisson.awayWinProb].sort((a, b) => b - a);
  const clarityGap = outcomes[0] - outcomes[1]; // How clear is the favorite?
  confidenceScore += Math.min(30, clarityGap); // Max 30 points

  // 9b. Data completeness
  if (formAvailable) confidenceScore += 15;
  if (apiPred) confidenceScore += 15;
  if (h2h.length >= 3) confidenceScore += 10;
  confidenceScore += Math.round((dataQuality.score - 35) * 0.18);

  // 9c. Market strength
  if (bestMarket?.prob >= 60) confidenceScore += 15;
  else if (bestMarket?.prob >= 50) confidenceScore += 8;

  // 9d. Signal alignment: form + poisson agree
  if (formAvailable && bestMarket?.type === 'home_win' && homeFormScore >= 60) confidenceScore += 10;
  if (formAvailable && bestMarket?.type === 'away_win' && awayFormScore >= 60) confidenceScore += 10;

  // 9e. Penalty for massive injuries on favorite
  if (bestMarket?.type === 'home_win' && homeInjuries >= 3) confidenceScore -= 20;
  if (bestMarket?.type === 'away_win' && awayInjuries >= 3) confidenceScore -= 20;

  // 9f. Bonus for Smart Money alignment
  if (realOdds) {
    if (bestMarket?.type === 'home_win' && realOdds.home < (100/poisson.homeWinProb) * 0.9) confidenceScore += 10;
    if (bestMarket?.type === 'away_win' && realOdds.away < (100/poisson.awayWinProb) * 0.9) confidenceScore += 10;
  }

  if (bestMarket?.valueEdge >= 8) confidenceScore += 8;
  if (bestMarket?.valueLabel === 'bad_price') confidenceScore -= 15;

  // 9g. Penalty for Rotation Risk (Champions League)
  if (bestMarket?.type === 'home_win' || bestMarket?.type === 'double_chance_1X') confidenceScore -= homeFatiguePenalty;
  if (bestMarket?.type === 'away_win' || bestMarket?.type === 'double_chance_X2') confidenceScore -= awayFatiguePenalty;

  const confidence = confidenceScore >= 65 ? 'high' : confidenceScore >= 40 ? 'medium' : 'low';

  // ── 10. Quality Gate ──────────────────────────────
  // A prono MUST pass this gate to be published
  const qualityGate = {
    passed: false,
    reason: '',
    minConfidence: 22, // Further reduced to allow more volume
    minProb: 38,       // Further reduced to allow high-odds picks
    minDataQuality: 35 
  };

  const needsClearWinner = ['home_win', 'away_win'].includes(bestMarket?.type);
  const minClarityGap = needsClearWinner ? 4 : 2; // Reduced gap requirements

  if (!bestMarket) {
    qualityGate.reason = 'Aucun marché viable identifié';
  } else if (dataQuality.score < qualityGate.minDataQuality) {
    qualityGate.reason = `Donnees insuffisantes (${dataQuality.score} < ${qualityGate.minDataQuality})`;
  } else if (bestMarket.prob < qualityGate.minProb) {
    qualityGate.reason = `Probabilité trop faible (${bestMarket.prob}% < ${qualityGate.minProb}%)`;
  } else if (confidenceScore < qualityGate.minConfidence) {
    qualityGate.reason = `Confiance insuffisante (${confidenceScore} < ${qualityGate.minConfidence})`;
  } else if (clarityGap < minClarityGap) {
    qualityGate.reason = `Match trop incertain (ecart ${clarityGap}% entre issues)`;
  } else if (bestMarket.valueLabel === 'bad_price') {
    qualityGate.reason = `Cote marche defavorable (${bestMarket.valueEdge}% edge)`;
  } else {
    qualityGate.passed = true;
    qualityGate.reason = 'Tous les critères de qualité satisfaits';
  }

  // ── 11. Generate signals summary ──────────────────
  if (poisson.over25Prob >= 65) signals.push(`Over 2.5 probable (${poisson.over25Prob}%)`);
  if (poisson.bttsProb >= 60) signals.push(`BTTS probable (${poisson.bttsProb}%)`);
  if (poisson.homeWinProb >= 55) signals.push(`Domicile favori (${poisson.homeWinProb}%)`);
  if (poisson.awayWinProb >= 50) signals.push(`Extérieur favori (${poisson.awayWinProb}%)`);
  if (homeXg >= 2.0) signals.push(`xG domicile élevé (${homeXg.toFixed(2)})`);
  if (awayXg >= 1.8) signals.push(`xG extérieur élevé (${awayXg.toFixed(2)})`);

  const aiPriorityScore = computeAiPriorityScore({
    scoring: { bestMarket, confidenceScore, dataQuality, warnings },
    match
  });

  return {
    // Core probabilities
    poisson,
    homeXg: Math.round(homeXg * 100) / 100,
    awayXg: Math.round(awayXg * 100) / 100,
    totalXg: Math.round((homeXg + awayXg) * 100) / 100,

    // Legacy fields (backward compat)
    home_win_score: compositeScore,
    over25_prob: poisson.over25Prob,
    btts_prob: poisson.bttsProb,
    home_expected_goals: Math.round(homeXg * 10) / 10,
    away_expected_goals: Math.round(awayXg * 10) / 10,

    // Form
    homeForm: homeFormScore,
    awayForm: awayFormScore,

    // Market recommendations
    markets: pricedMarkets,
    bestMarket,

    // Quality
    confidenceScore,
    confidence,
    qualityGate,
    dataQuality,
    aiPriorityScore,

    // Signals
    signals,
    warnings,

    // API predictions alignment
    apiPredictions: apiPred ? {
      homeProb: apiHomeProb,
      drawProb: apiDrawProb,
      awayProb: apiAwayProb,
      advice: apiAdvice
    } : null,

    // Market context
    bookmakerOdds: realOdds,
    injuriesSummary: injuries.length > 0 ? {
      home: homeInjuries,
      away: awayInjuries,
      details: injuries
    } : null,
    standingsSummary: standings.length > 0 ? {
      homeRank, awayRank, homeDesc, awayDesc
    } : null,
    nextMatchSummary: {
      home: homeNext,
      away: awayNext
    },

    // H2H summary
    h2hSummary: h2h.length > 0 ? {
      total: h2h.length,
      homeWins: h2hHomeWins,
      draws: h2hDraws,
      awayWins: h2hAwayWins,
      avgGoals: Math.round((h2hTotalGoals / h2h.length) * 10) / 10
    } : null,

    // Exact scores
    topScores: poisson.topScores
  };
}

/**
 * Rank matches by analysis quality — best first.
 */
export function rankMatchesByQuality(matches) {
  return matches
    .map(m => ({ match: m, scoring: scoreMatch(m) }))
    .filter(({ scoring }) => scoring.qualityGate.passed)
    .sort((a, b) => {
      // Primary: AI Priority Score
      if (b.scoring.aiPriorityScore !== a.scoring.aiPriorityScore) {
        return b.scoring.aiPriorityScore - a.scoring.aiPriorityScore;
      }
      return b.scoring.confidenceScore - a.scoring.confidenceScore;
    });
}

/**
 * Generate combined coupons from a list of pronos.
 * Focus on "Safe" matches to reach 70-80% success.
 */
export function generateCoupons(pronos) {
  if (pronos.length < 2) return [];

  const coupons = [];
  
  // Sort by probability to find the safest ones
  const safePicks = [...pronos]
    .filter(p => !['Score Exact', 'Grosse Cote'].includes(p.categorie))
    .sort((a, b) => (b.fiabilite || 0) - (a.fiabilite || 0));

  // Coupon 1: "Le Duo Safe" (2 matches, cote ~2.00)
  if (safePicks.length >= 2) {
    const p1 = safePicks[0];
    const p2 = safePicks[1];
    const totalOdds = Math.round((p1.cote * p2.cote) * 100) / 100;
    
    coupons.push({
      id: `coupon_${Date.now()}_1`,
      title: "Le Duo GOLIAT 💎",
      description: "Notre sélection la plus fiable pour doubler votre mise.",
      type: 'combiné',
      matches: [
        { match: p1.match, prono: p1.prono, cote: p1.cote },
        { match: p2.match, prono: p2.prono, cote: p2.cote }
      ],
      totalOdds,
      fiabilite: Math.round((p1.fiabilite + p2.fiabilite) / 2 * 0.9), // Slightly lower fiabilite for combined
      is_vip: true
    });
  }

  // Coupon 2: "Le Triple Fun" (3 matches, cote ~4.00-6.00)
  if (safePicks.length >= 3) {
    const p1 = safePicks[0];
    const p2 = safePicks[2];
    const p3 = safePicks[Math.min(safePicks.length - 1, 4)];
    const totalOdds = Math.round((p1.cote * p2.cote * p3.cote) * 100) / 100;

    coupons.push({
      id: `coupon_${Date.now()}_2`,
      title: "Le Triple de l'Expert ⚡",
      description: "Une combinaison optimisée pour un gain maximum.",
      type: 'combiné',
      matches: [
        { match: p1.match, prono: p1.prono, cote: p1.cote },
        { match: p2.match, prono: p2.prono, cote: p2.cote },
        { match: p3.match, prono: p3.prono, cote: p3.cote }
      ],
      totalOdds,
      fiabilite: Math.round((p1.fiabilite + p2.fiabilite + p3.fiabilite) / 3 * 0.8),
      is_vip: true
    });
  }

  return coupons;
}
