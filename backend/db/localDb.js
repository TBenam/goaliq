import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'goliat-local.db');

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

    CREATE TABLE IF NOT EXISTS crm_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      page TEXT,
      visitor_id TEXT,
      vip_code TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      meta_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_crm_events_created_at
      ON crm_events(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_crm_events_type_page
      ON crm_events(event_type, page);

    CREATE TABLE IF NOT EXISTS subscription_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      plan TEXT NOT NULL,
      amount_fcfa INTEGER NOT NULL DEFAULT 0,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'paid',
      source TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      meta_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_subscription_transactions_created_at
      ON subscription_transactions(created_at DESC);
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
    `),
    insertCrmEvent: db.prepare(`
      INSERT INTO crm_events (
        event_type, page, visitor_id, vip_code, ip, user_agent, created_at, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertSubscriptionTransaction: db.prepare(`
      INSERT INTO subscription_transactions (
        code, plan, amount_fcfa, phone, status, source, created_at, expires_at, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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

function toIsoDay(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function buildRange(days = 7) {
  const safeDays = Math.max(1, Math.min(Number(days) || 7, 90));
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (safeDays - 1));

  return {
    startIso: start.toISOString(),
    days: safeDays
  };
}

export function logCrmEvent(entry = {}) {
  if (!db || !statements) return;

  try {
    statements.insertCrmEvent.run(
      entry.eventType || 'page_view',
      entry.page || null,
      entry.visitorId || null,
      entry.vipCode || null,
      entry.ip || null,
      entry.userAgent || null,
      entry.createdAt || new Date().toISOString(),
      json(entry.meta)
    );
  } catch (err) {
    logger.warn(`[LocalDB] Event CRM echoue: ${err.message}`);
  }
}

export function logSubscriptionTransaction(entry = {}) {
  if (!db || !statements) return;

  try {
    statements.insertSubscriptionTransaction.run(
      String(entry.code || '').toUpperCase(),
      entry.plan || 'monthly',
      Number(entry.amountFcfa || 0),
      entry.phone || null,
      entry.status || 'paid',
      entry.source || 'admin',
      entry.createdAt || new Date().toISOString(),
      entry.expiresAt || null,
      json(entry.meta)
    );
  } catch (err) {
    logger.warn(`[LocalDB] Transaction abonnement echouee: ${err.message}`);
  }
}

export function getCrmOverview({ days = 7 } = {}) {
  if (!db) {
    return {
      enabled: false,
      range_days: Math.max(1, Math.min(Number(days) || 7, 90)),
      totals: {},
      daily: [],
      top_pages: [],
      subscriptions: [],
      recent_events: []
    };
  }

  const { startIso, days: rangeDays } = buildRange(days);
  const today = toIsoDay();
  const todayStart = `${today}T00:00:00.000Z`;

  const scalar = (sql, params = []) => {
    try {
      return db.prepare(sql).get(...params)?.value ?? 0;
    } catch (err) {
      logger.warn(`[LocalDB] CRM scalar echoue: ${err.message}`);
      return 0;
    }
  };

  const all = (sql, params = []) => {
    try {
      return db.prepare(sql).all(...params);
    } catch (err) {
      logger.warn(`[LocalDB] CRM query echoue: ${err.message}`);
      return [];
    }
  };

  const daily = all(`
    SELECT
      substr(created_at, 1, 10) AS day,
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN COALESCE(visitor_id, ip, user_agent) END) AS visits,
      COUNT(DISTINCT CASE WHEN event_type = 'vip_checkout' THEN COALESCE(visitor_id, vip_code) END) AS checkout_intents,
      0 AS subscriptions,
      0 AS revenue_fcfa
    FROM crm_events
    WHERE created_at >= ?
    GROUP BY day
    ORDER BY day DESC
  `, [startIso]);

  const subscriptionDaily = all(`
    SELECT
      substr(created_at, 1, 10) AS day,
      COUNT(*) AS subscriptions,
      COALESCE(SUM(amount_fcfa), 0) AS revenue_fcfa
    FROM subscription_transactions
    WHERE created_at >= ? AND status = 'paid'
    GROUP BY day
  `, [startIso]);

  const dailyMap = new Map(daily.map((row) => [row.day, { ...row }]));
  for (const row of subscriptionDaily) {
    const current = dailyMap.get(row.day) || {
      day: row.day,
      page_views: 0,
      visits: 0,
      checkout_intents: 0,
      subscriptions: 0,
      revenue_fcfa: 0
    };
    current.subscriptions = row.subscriptions || 0;
    current.revenue_fcfa = row.revenue_fcfa || 0;
    dailyMap.set(row.day, current);
  }

  const mergedDaily = Array.from(dailyMap.values()).sort((a, b) => b.day.localeCompare(a.day));

  const todayRevenue = scalar(`
    SELECT COALESCE(SUM(amount_fcfa), 0) AS value
    FROM subscription_transactions
    WHERE created_at >= ? AND status = 'paid'
  `, [todayStart]);

  const rangeRevenue = scalar(`
    SELECT COALESCE(SUM(amount_fcfa), 0) AS value
    FROM subscription_transactions
    WHERE created_at >= ? AND status = 'paid'
  `, [startIso]);

  const subscriptions = all(`
    SELECT code, plan, amount_fcfa, phone, status, source, created_at, expires_at
    FROM subscription_transactions
    ORDER BY created_at DESC
    LIMIT 20
  `);

  const planRevenue = all(`
    SELECT plan, COUNT(*) AS subscriptions, COALESCE(SUM(amount_fcfa), 0) AS revenue_fcfa
    FROM subscription_transactions
    WHERE created_at >= ? AND status = 'paid'
    GROUP BY plan
    ORDER BY revenue_fcfa DESC
  `, [startIso]);

  const checkoutIntentsRange = scalar(`
    SELECT COUNT(*) AS value
    FROM crm_events
    WHERE event_type = 'vip_checkout' AND created_at >= ?
  `, [startIso]);

  const subscriptionsRange = scalar(`
    SELECT COUNT(*) AS value
    FROM subscription_transactions
    WHERE created_at >= ? AND status = 'paid'
  `, [startIso]);

  const pageViewsRange = scalar(`
    SELECT COUNT(*) AS value
    FROM crm_events
    WHERE event_type = 'page_view' AND created_at >= ?
  `, [startIso]);

  return {
    enabled: true,
    range_days: rangeDays,
    totals: {
      visits_today: scalar(`
        SELECT COUNT(DISTINCT COALESCE(visitor_id, ip, user_agent)) AS value
        FROM crm_events
        WHERE event_type = 'page_view' AND created_at >= ?
      `, [todayStart]),
      page_views_today: scalar(`
        SELECT COUNT(*) AS value
        FROM crm_events
        WHERE event_type = 'page_view' AND created_at >= ?
      `, [todayStart]),
      subscriptions_today: scalar(`
        SELECT COUNT(*) AS value
        FROM subscription_transactions
        WHERE created_at >= ? AND status = 'paid'
      `, [todayStart]),
      revenue_today_fcfa: todayRevenue,
      visits_range: scalar(`
        SELECT COUNT(DISTINCT COALESCE(visitor_id, ip, user_agent)) AS value
        FROM crm_events
        WHERE event_type = 'page_view' AND created_at >= ?
      `, [startIso]),
      page_views_range: scalar(`
        SELECT COUNT(*) AS value
        FROM crm_events
        WHERE event_type = 'page_view' AND created_at >= ?
      `, [startIso]),
      subscriptions_range: subscriptionsRange,
      revenue_range_fcfa: rangeRevenue,
      checkout_intents_range: checkoutIntentsRange,
      average_order_value_fcfa: subscriptionsRange > 0 ? Math.round(rangeRevenue / subscriptionsRange) : 0,
      checkout_conversion_rate: checkoutIntentsRange > 0 ? Math.round((subscriptionsRange / checkoutIntentsRange) * 100) : 0,
      revenue_per_page_view_fcfa: pageViewsRange > 0 ? Math.round(rangeRevenue / pageViewsRange) : 0
    },
    daily: mergedDaily,
    plan_revenue: planRevenue,
    top_pages: all(`
      SELECT page, COUNT(*) AS views, COUNT(DISTINCT COALESCE(visitor_id, ip, user_agent)) AS visits
      FROM crm_events
      WHERE event_type = 'page_view' AND created_at >= ?
      GROUP BY page
      ORDER BY views DESC
      LIMIT 8
    `, [startIso]),
    subscriptions,
    recent_events: all(`
      SELECT event_type, page, visitor_id, vip_code, created_at
      FROM crm_events
      ORDER BY created_at DESC
      LIMIT 20
    `)
  };
}
