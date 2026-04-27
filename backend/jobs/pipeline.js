import cron from 'node-cron';
import { fetchMatches, updateResults } from './collectMatches.js';
import { runDailyAnalysis } from './groqAnalyzer.js';
import { getCacheInfo, isCacheFresh } from '../cache/manager.js';
import { finishPipelineRun, startPipelineRun } from '../db/localDb.js';
import { logger } from '../utils/logger.js';

const DEFAULT_INTERVAL_HOURS = 8;
const DEFAULT_RESULTS_CRON = '*/30 * * * *';

let schedulerStarted = false;
let pipelineTask = null;
let resultsTask = null;
let promoTask = null;
let offeredPronoTask = null;

function getPromoCron() {
  return process.env.PROMO_VIP_CRON || '0 17 * * *'; // Everyday at 17:00 by default
}

function getIntervalHours() {
  const parsed = Number.parseInt(process.env.PIPELINE_INTERVAL_HOURS || `${DEFAULT_INTERVAL_HOURS}`, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 24
    ? parsed
    : DEFAULT_INTERVAL_HOURS;
}

function getTimezone() {
  return process.env.SCHEDULER_TIMEZONE || process.env.TZ || 'Africa/Douala';
}

function getPipelineCron() {
  return `0 */${getIntervalHours()} * * *`;
}

function getResultsCron() {
  return process.env.RESULTS_UPDATE_CRON || DEFAULT_RESULTS_CRON;
}

export function getSchedulerStatus() {
  return {
    started: schedulerStarted,
    interval_hours: getIntervalHours(),
    pipelineCron: getPipelineCron(),
    resultsCron: getResultsCron(),
    promoCron: getPromoCron(),
    timezone: getTimezone()
  };
}

export async function runFullPipeline(reason = 'scheduled') {
  const startedAt = new Date().toISOString();
  const timer = Date.now();
  const runId = startPipelineRun({
    jobName: 'full_pipeline',
    reason,
    meta: getSchedulerStatus()
  });

  logger.info(`[Pipeline] Demarrage (${reason})`);

  try {
    const matches = await fetchMatches();

    if (!matches.length) {
      finishPipelineRun(runId, {
        status: 'skipped',
        startedAt,
        matchesCount: 0,
        pronosCount: 0,
        meta: { reason: 'no_matches', cache: getCacheInfo() }
      });
      logger.warn('[Pipeline] Aucun match collecte. Analyse annulee.');
      return [];
    }

    const pronos = await runDailyAnalysis();
    const duration = ((Date.now() - timer) / 1000).toFixed(1);

    finishPipelineRun(runId, {
      status: 'completed',
      startedAt,
      matchesCount: matches.length,
      pronosCount: pronos.length,
      meta: { cache: getCacheInfo(), duration_seconds: Number(duration) }
    });

    logger.info(`[Pipeline] Termine en ${duration}s avec ${matches.length} matchs et ${pronos.length} pronos.`);
    return pronos;
  } catch (err) {
    finishPipelineRun(runId, {
      status: 'failed',
      startedAt,
      errorMessage: err.message,
      meta: { cache: getCacheInfo() }
    });
    logger.error(`[Pipeline] Erreur critique: ${err.message}`);
    throw err;
  }
}

export async function runResultsRefresh(reason = 'results-cron') {
  try {
    await updateResults();
    logger.debug(`[Results] Rafraichissement termine (${reason})`);
  } catch (err) {
    logger.warn(`[Results] Erreur (${reason}): ${err.message}`);
  }
}

export async function sendPromoNotification() {
  const promos = [
    { title: '🔥 Alerte VIP', body: 'André a gagné 60 000F en pariant 2000F hier. Rejoins le VIP !' },
    { title: '👑 La Montante VIP', body: 'Le palier 4 a été validé ! Ne rate pas le prochain match.' },
    { title: '⚡ Grosse Cote VIP validée', body: 'Score exact @9.50 validé hier. Rejoins l\'élite.' }
  ];
  const promo = promos[Math.floor(Math.random() * promos.length)];

  try {
    const { db, sendPushToTokens } = await import('../firebase/admin.js');
    if (!db) return;

    const snap = await db.collection('fcm_tokens').where('is_vip', '==', false).get();
    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) return;

    await sendPushToTokens(tokens, promo, { url: '/#vip', type: 'promo_vip' });
    logger.info(`[FCM] Promo VIP envoyée à ${tokens.length} utilisateurs non-VIP`);
  } catch (err) {
    logger.warn('[FCM] Erreur Promo VIP:', err.message);
  }
}

export async function sendRandomVipPronoNotification() {
  try {
    const { cacheGet } = await import('../cache/manager.js');
    const pronoCache = cacheGet('pronos', 24);
    const pronos = pronoCache?.data || [];

    // Find a prono that is "offered free" and starts soon (next 2 hours)
    const now = new Date();
    const offered = pronos.find(p => 
      p.is_offered_free && 
      new Date(p.kickoff) > now && 
      new Date(p.kickoff) < new Date(now.getTime() + 120 * 60000)
    );

    if (!offered) return;

    const { db, sendPushToTokens } = await import('../firebase/admin.js');
    if (!db) return;

    // To make it "random", we only send it if a random check passes (50% chance every hour)
    if (Math.random() > 0.5) {
      logger.info(`[FCM] Saut de la notification aléatoire pour ${offered.match} (chance)`);
      return;
    }

    const snap = await db.collection('fcm_tokens').where('is_vip', '==', false).get();
    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) return;

    const message = {
      title: `🎁 CADEAU : Prono VIP Offert !`,
      body: `Le prono VIP sur ${offered.match} est exceptionnellement GRATUIT. Découvrez-le vite !`
    };

    await sendPushToTokens(tokens, message, { url: '/#pronos', type: 'vip_offered' });
    logger.info(`[FCM] Prono VIP Offert envoyé à ${tokens.length} utilisateurs pour ${offered.match}`);
  } catch (err) {
    logger.warn('[FCM] Erreur Prono VIP Offert:', err.message);
  }
}

export function startScheduler({ runOnStart = true, skipStartupIfFresh = true } = {}) {
  if (schedulerStarted) {
    return getSchedulerStatus();
  }

  const timezone = getTimezone();
  const pipelineCron = getPipelineCron();
  const resultsCron = getResultsCron();
  const promoCron = getPromoCron();

  pipelineTask = cron.schedule(pipelineCron, () => {
    runFullPipeline(`cron-${getIntervalHours()}h`).catch(() => {});
  }, { timezone });

  resultsTask = cron.schedule(resultsCron, () => {
    runResultsRefresh('results-cron').catch(() => {});
  }, { timezone });

  promoTask = cron.schedule(promoCron, () => {
    sendPromoNotification().catch(() => {});
  }, { timezone });

  // Every hour, check if we should send an offered prono notification
  offeredPronoTask = cron.schedule('0 * * * *', () => {
    sendRandomVipPronoNotification().catch(() => {});
  }, { timezone });

  schedulerStarted = true;

  logger.info(`[Scheduler] Pipeline: ${pipelineCron} (${timezone})`);
  logger.info(`[Scheduler] Resultats: ${resultsCron} (${timezone})`);
  logger.info(`[Scheduler] Promo VIP: ${promoCron} (${timezone})`);
  logger.info(`[Scheduler] Prono Offert: hourly check (${timezone})`);

  if (runOnStart) {
    setTimeout(() => {
      if (skipStartupIfFresh && isCacheFresh('pronos', Math.max(1, getIntervalHours() - 1))) {
        logger.info('[Scheduler] Cache encore frais. Pipeline de demarrage saute.');
        return;
      }

      runFullPipeline('startup').catch(() => {});
    }, 0);
  }

  return getSchedulerStatus();
}

export async function bootSchedulerProcess({ runOnce = false, skipIfFresh = false } = {}) {
  logger.info('[Scheduler] Processus autonome demarre');
  startScheduler({ runOnStart: false });

  if (skipIfFresh && isCacheFresh('pronos', Math.max(1, getIntervalHours() - 1))) {
    logger.info('[Scheduler] Cache frais detecte. Aucun lancement immediat.');
    return;
  }

  await runFullPipeline(runOnce ? 'cli-once' : 'startup');
}
