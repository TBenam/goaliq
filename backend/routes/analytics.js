import { Router } from 'express';
import { logCrmEvent } from '../db/localDb.js';

const router = Router();

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || req.ip
    || null;
}

router.post('/event', (req, res) => {
  const {
    event_type = 'page_view',
    page = null,
    visitor_id = null,
    vip_code = null,
    meta = null
  } = req.body || {};

  const allowedEvents = new Set(['page_view', 'vip_checkout', 'vip_activation_check', 'admin_open']);
  const eventType = allowedEvents.has(event_type) ? event_type : 'page_view';

  logCrmEvent({
    eventType,
    page: String(page || '').slice(0, 80) || null,
    visitorId: String(visitor_id || '').slice(0, 120) || null,
    vipCode: String(vip_code || '').toUpperCase().slice(0, 40) || null,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    meta
  });

  return res.status(202).json({ success: true });
});

export default router;
