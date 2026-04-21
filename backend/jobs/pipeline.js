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

export function startScheduler({ runOnStart = true, skipStartupIfFresh = true } = {}) {
  if (schedulerStarted) {
    return getSchedulerStatus();
  }

  const timezone = getTimezone();
  const pipelineCron = getPipelineCron();
  const resultsCron = getResultsCron();

  pipelineTask = cron.schedule(pipelineCron, () => {
    runFullPipeline(`cron-${getIntervalHours()}h`).catch(() => {});
  }, { timezone });

  resultsTask = cron.schedule(resultsCron, () => {
    runResultsRefresh('results-cron').catch(() => {});
  }, { timezone });

  schedulerStarted = true;

  logger.info(`[Scheduler] Pipeline: ${pipelineCron} (${timezone})`);
  logger.info(`[Scheduler] Resultats: ${resultsCron} (${timezone})`);

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
