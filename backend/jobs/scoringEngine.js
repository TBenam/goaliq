/* ====================================================
   GOLIAT — Scoring Engine
   Algorithme de scoring 0-100 basé sur les stats
   Input: row de la collection Firestore 'matches'
   Output: { home_win_score, over25_prob, signals, recommendation }
   ==================================================== */

/**
 * Parse a form string like "WWLWD" → weighted score 0-100
 * More recent results have higher weight
 */
function parseForm(form = '') {
  if (!form) return 50;
  const chars = form.replace(/[^WDL]/gi, '').split('').slice(-5);
  if (!chars.length) return 50;

  const total = chars.reduce((acc, r, i) => {
    const weight = (i + 1) / chars.length; // last result = full weight
    const points = r.toUpperCase() === 'W' ? 3 : r.toUpperCase() === 'D' ? 1 : 0;
    return acc + points * weight;
  }, 0);

  // Normalize to 0-100
  const maxPossible = chars.reduce((acc, _, i) => acc + 3 * ((i + 1) / chars.length), 0);
  return Math.round((total / maxPossible) * 100);
}

/**
 * Estimate Over 2.5 probability based on team attack/defense averages
 */
function calcOver25Prob(homeAttack, awayAttack, homeDefense, awayDefense) {
  const homeExpected = (parseFloat(homeAttack) + parseFloat(awayDefense)) / 2;
  const awayExpected = (parseFloat(awayAttack) + parseFloat(homeDefense)) / 2;
  const totalExpected = homeExpected + awayExpected;

  if (totalExpected >= 3.5) return Math.min(92, 70 + (totalExpected - 3.5) * 10);
  if (totalExpected >= 2.5) return Math.min(70, 50 + (totalExpected - 2.5) * 18);
  return Math.max(20, 30 + totalExpected * 5);
}

/**
 * Main scoring function
 * @param {object} match - Firestore match document
 * @returns {ScoringResult}
 */
export function scoreMatch(match) {
  let score = 50; // Neutral baseline
  const signals = [];
  const warnings = [];

  // ── 1. Form Analysis ──────────────────────────────
  const homeFormScore = parseForm(match.home_form);
  const awayFormScore = parseForm(match.away_form);
  const formDelta = homeFormScore - awayFormScore;

  score += formDelta * 0.3;

  if (homeFormScore >= 70) signals.push('Domicile en grande forme');
  if (awayFormScore >= 70) warnings.push('Extérieur en grande forme');
  if (homeFormScore <= 30) warnings.push('Domicile en mauvaise passe');
  if (awayFormScore <= 30) signals.push('Extérieur en crise de forme');

  // ── 2. Home Advantage (standard +8% baseline) ─────
  score += 8;

  // ── 3. Attack vs Defense Analysis ─────────────────
  const homeAtt = parseFloat(match.home_goals_avg || 1.2);
  const awayAtt = parseFloat(match.away_goals_avg || 1.0);
  const homeDef = parseFloat(match.home_goals_conceded || 1.2);
  const awayDef = parseFloat(match.away_goals_conceded || 1.2);

  const homeExpectedGoals = (homeAtt + awayDef) / 2;
  const awayExpectedGoals = (awayAtt + homeDef) / 2;

  if (homeExpectedGoals > 2.0) { score += 12; signals.push('Attaque domicile très prolifique'); }
  else if (homeExpectedGoals > 1.5) { score += 6; signals.push('Attaque domicile solide'); }

  if (awayExpectedGoals > 1.8) { score -= 8; warnings.push('Attaque extérieur dangereuse'); }
  if (homeDef < 0.9) { score += 8; signals.push('Défense domicile imperméable'); }
  if (awayDef < 0.9) { score -= 6; warnings.push("Défense extérieur costaud"); }

  // ── 4. Over 2.5 Probability ───────────────────────
  const over25Prob = calcOver25Prob(homeAtt, awayAtt, homeDef, awayDef);
  const totalExpected = homeExpectedGoals + awayExpectedGoals;

  if (over25Prob >= 70) signals.push(`Over 2.5 probable (${Math.round(over25Prob)}%)`);
  if (totalExpected < 1.8) signals.push('Match fermé, Under 2.5 favori');

  // ── 5. BTTS signal ────────────────────────────────
  const bttsProbEstimate = Math.min(90, (homeAtt * 25) + (awayAtt * 20) - (homeDef * 10));
  if (bttsProbEstimate >= 65) signals.push('BTTS probable');

  // ── 6. Normalize score ────────────────────────────
  const finalScore = Math.min(95, Math.max(10, Math.round(score)));

  // ── 7. Recommendation ─────────────────────────────
  let recommendation;
  if (finalScore >= 68)      recommendation = 'home_win';
  else if (finalScore <= 32) recommendation = 'away_win';
  else if (over25Prob >= 65) recommendation = 'over25';
  else if (bttsProbEstimate >= 65) recommendation = 'btts';
  else                       recommendation = 'draw_or_low_scoring';

  return {
    home_win_score: finalScore,
    over25_prob: Math.round(over25Prob),
    btts_prob: Math.round(bttsProbEstimate),
    home_expected_goals: Math.round(homeExpectedGoals * 10) / 10,
    away_expected_goals: Math.round(awayExpectedGoals * 10) / 10,
    signals,
    warnings,
    recommendation,
    confidence: finalScore >= 70 || finalScore <= 30 ? 'high' : finalScore >= 60 || finalScore <= 40 ? 'medium' : 'low'
  };
}
