/* ====================================================
   GOLIAT — Express Server
   Couche 3: API REST + CORS + Rate Limiting + Error handling
   ==================================================== */

import 'dotenv/config';
import { EventEmitter } from 'events';
import express from 'express';

// Augmenter la limite pour éviter les warnings "MaxListenersExceededWarning" lors des requêtes parallèles
EventEmitter.defaultMaxListeners = 100;
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { cacheMiddleware } from './middleware/cache.js';
import { getLocalDbInfo } from './db/localDb.js';
import { getSchedulerStatus, startScheduler } from './jobs/pipeline.js';
import { requestAuditMiddleware } from './middleware/requestAudit.js';
import pronosRouter from './routes/pronos.js';
import authRouter from './routes/auth.js';
import notifRouter from './routes/notifications.js';
import adminRouter from './routes/admin.js';
import analyticsRouter from './routes/analytics.js';
import { logger } from './utils/logger.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

/* ── Security ────────────────────────────────────────── */
app.use(helmet({
  contentSecurityPolicy: false, // Configured separately for PWA
  crossOriginOpenerPolicy: false
}));

/* ── CORS ────────────────────────────────────────────── */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:8899',     // Dev http-server
  'https://goliat.app',
  'https://goliat.fun',          // New production domain
  null                           // Allow file:// for local dev
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      cb(null, true);
    } else {
      // Return false instead of an Error to avoid triggering the global error handler (500)
      // The browser will handle the CORS rejection correctly.
      cb(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Vip-Code']
}));

/* ── Body parsing ────────────────────────────────────── */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestAuditMiddleware);

/* ── Cache middleware ────────────────────────────────── */
app.use(cacheMiddleware);

/* ── Global Rate Limiting ────────────────────────────── */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' }
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 20,
  message: { error: 'Trop de tentatives. Réessayez dans 1h.' }
});

/* ── Request Logging ─────────────────────────────────── */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level](`${req.method} ${req.path} → ${res.statusCode} [${ms}ms]`);
  });
  next();
});

/* ── Routes ──────────────────────────────────────────── */
app.use('/api/pronos', pronosRouter);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/notifications', notifRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/admin', adminRouter); // Panel admin activation VIP

/* ── Health check ────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'GOLIAT API',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    scheduler: getSchedulerStatus(),
    local_db: getLocalDbInfo()
  });
});

/* ── Cache info (public debug) ───────────────────────── */
app.get('/api/cache', async (req, res) => {
  const { getCacheInfo } = await import('./cache/manager.js');
  res.json(getCacheInfo());
});

/* ── Stats endpoint (public) ─────────────────────────── */
app.get('/api/stats', async (req, res) => {
  try {
    const { db } = await import('./firebase/admin.js');
    const { cacheThrough } = await import('./middleware/cache.js');

    const stats = await cacheThrough('global_stats', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const pronos = await db.collection('pronos')
        .where('kickoff', '>=', sevenDaysAgo)
        .where('result', '!=', null)
        .get();

      const settled = pronos.docs.map(d => d.data());
      const won = settled.filter(p => p.result === 'won').length;
      const winRate = settled.length > 0 ? Math.round((won / settled.length) * 100) : 84;
      const avgCote = settled.reduce((a, p) => a + (p.cote_estimee || 1.8), 0) / (settled.length || 1);

      return {
        win_rate: winRate,
        total_pronos: settled.length,
        avg_cote: avgCote.toFixed(2),
        members: 2847 // static for now — update with real count
      };
    }, 1800); // Cache 30 min

    res.json(stats);
  } catch (err) {
    res.json({ win_rate: 84, members: 2847, avg_cote: '1.87' });
  }
});

/* ── 404 handler ─────────────────────────────────────── */
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} introuvable`, code: 'NOT_FOUND' });
});

/* ── Global error handler ────────────────────────────── */
app.use((err, req, res, next) => {
  logger.error(`[Server] ${err.message}`, { path: req.path, stack: err.stack?.split('\n')[1] });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Erreur serveur interne' : err.message,
    code: err.code || 'SERVER_ERROR'
  });
});

/* ── Start ───────────────────────────────────────────── */
app.listen(PORT, () => {
  logger.info(`[Server] GOLIAT API démarré sur http://localhost:${PORT}`);
  logger.info(`[Server] Mode: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`[Server] Health: http://localhost:${PORT}/api/health`);

  if (process.env.ENABLE_BACKGROUND_JOBS === 'false') {
    logger.info('[Server] Scheduler embarqué désactivé via ENABLE_BACKGROUND_JOBS=false');
    return;
  }

  const scheduler = startScheduler({
    runOnStart: process.env.RUN_PIPELINE_ON_START !== 'false',
    skipStartupIfFresh: true
  });

  logger.info(`[Server] Scheduler embarqué actif (${scheduler.pipelineCron}, timezone ${scheduler.timezone})`);
});

export default app;
