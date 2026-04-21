import { randomUUID } from 'crypto';
import { logRequest } from '../db/localDb.js';

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || req.ip
    || null;
}

export function requestAuditMiddleware(req, res, next) {
  const startedAt = Date.now();
  const requestId = randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    logRequest({
      requestId,
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      userUid: req.user?.uid || null,
      cacheSource: res.getHeader('X-GoalIQ-Data-Source') || null,
      requestedAt: new Date(startedAt).toISOString(),
      meta: {
        query: req.query,
        contentLength: res.getHeader('content-length') || null
      }
    });
  });

  next();
}
