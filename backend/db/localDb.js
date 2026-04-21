import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'goaliq-local.db');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;
let statements = null;

try {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      original_url TEXT,
      status_code INTEGER,
      duration_ms INTEGER,
      ip TEXT,
      user_agent TEXT,
      user_uid TEXT,
      cache_source TEXT,
      requested_at TEXT NOT NULL,
      meta_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_request_logs_requested_at
      ON request_logs(requested_at DESC);

    CREATE INDEX IF NOT EXISTS idx_request_logs_path
      ON request_logs(path);

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      matches_count INTEGER,
      pronos_count INTEGER,
      error_message TEXT,
      meta_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at
      ON pipeline_runs(started_at DESC);
  `);

  statements = {
    insertRequest: db.prepare(`
      INSERT INTO request_logs (
        request_id, method, path, original_url, status_code, duration_ms,
        ip, user_agent, user_uid, cache_source, requested_at, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertPipelineRun: db.prepare(`
      INSERT INTO pipeline_runs (
        job_name, reason, status, started_at, meta_json
      ) VALUES (?, ?, ?, ?, ?)
    `),
    finishPipelineRun: db.prepare(`
      UPDATE pipeline_runs
      SET status = ?, finished_at = ?, duration_ms = ?, matches_count = ?,
          pronos_count = ?, error_message = ?, meta_json = ?
      WHERE id = ?
    `)
  };

  logger.info(`[LocalDB] SQLite prêt: ${DB_PATH}`);
} catch (err) {
  logger.warn(`[LocalDB] SQLite indisponible, audit désactivé: ${err.message}`);
}

function json(value) {
  if (value === undefined || value === null) return null;

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function getLocalDbInfo() {
  return {
    enabled: Boolean(db),
    engine: db ? 'sqlite' : 'disabled',
    path: DB_PATH
  };
}

export function logRequest(entry) {
  if (!db || !statements) return;

  try {
    statements.insertRequest.run(
      entry.requestId,
      entry.method,
      entry.path,
      entry.originalUrl || entry.path,
      entry.statusCode ?? null,
      entry.durationMs ?? null,
      entry.ip || null,
      entry.userAgent || null,
      entry.userUid || null,
      entry.cacheSource || null,
      entry.requestedAt || new Date().toISOString(),
      json(entry.meta)
    );
  } catch (err) {
    logger.warn(`[LocalDB] Log requête échoué: ${err.message}`);
  }
}

export function startPipelineRun({ jobName, reason, meta } = {}) {
  if (!db || !statements) return null;

  try {
    const result = statements.insertPipelineRun.run(
      jobName || 'pipeline',
      reason || 'scheduled',
      'running',
      new Date().toISOString(),
      json(meta)
    );
    return Number(result.lastInsertRowid);
  } catch (err) {
    logger.warn(`[LocalDB] Start pipeline échoué: ${err.message}`);
    return null;
  }
}

export function finishPipelineRun(id, {
  status = 'completed',
  startedAt,
  matchesCount = null,
  pronosCount = null,
  errorMessage = null,
  meta = null
} = {}) {
  if (!db || !statements || !id) return;

  const finishedAt = new Date().toISOString();
  const durationMs = startedAt
    ? Math.max(0, Date.now() - new Date(startedAt).getTime())
    : null;

  try {
    statements.finishPipelineRun.run(
      status,
      finishedAt,
      durationMs,
      matchesCount,
      pronosCount,
      errorMessage,
      json(meta),
      id
    );
  } catch (err) {
    logger.warn(`[LocalDB] Fin pipeline échouée: ${err.message}`);
  }
}
