import 'dotenv/config';
import { bootSchedulerProcess, getSchedulerStatus, startScheduler } from './pipeline.js';
import { logger } from '../utils/logger.js';

const args = new Set(process.argv.slice(2));
const runOnce = args.has('--once');
const skipIfFresh = args.has('--skip-if-fresh');

logger.info('[Scheduler] GOLIAT pipeline autonome');

if (runOnce) {
  await bootSchedulerProcess({ runOnce: true, skipIfFresh });
  logger.info('[Scheduler] Mode --once terminé.');
  process.exit(0);
}

await bootSchedulerProcess({ runOnce: false, skipIfFresh });
const status = startScheduler({ runOnStart: false });

logger.info(`[Scheduler] En attente des prochains cycles (${status.pipelineCron}, timezone ${status.timezone})`);
logger.info(`[Scheduler] Statut: ${JSON.stringify(getSchedulerStatus())}`);
