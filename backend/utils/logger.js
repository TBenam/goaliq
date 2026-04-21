/* ====================================================
   GoalIQ — Logger
   Simple structured logger with timestamps
   ==================================================== */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 2;

function formatMessage(level, message, ...args) {
  const ts = new Date().toLocaleTimeString('fr', { hour12: false });
  const levelStr = level.toUpperCase().padEnd(5);
  const extra = args.length ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') : '';
  return `[${ts}] ${levelStr} ${message}${extra}`;
}

export const logger = {
  error: (msg, ...args) => LEVELS.error <= currentLevel && console.error(formatMessage('error', msg, ...args)),
  warn:  (msg, ...args) => LEVELS.warn  <= currentLevel && console.warn(formatMessage('warn', msg, ...args)),
  info:  (msg, ...args) => LEVELS.info  <= currentLevel && console.log(formatMessage('info', msg, ...args)),
  debug: (msg, ...args) => LEVELS.debug <= currentLevel && console.log(formatMessage('debug', msg, ...args))
};
