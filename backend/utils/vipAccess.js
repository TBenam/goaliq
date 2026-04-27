import { cacheRead } from '../cache/manager.js';

export function normalizeVipCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function getVipCodeEntry(code) {
  const cleanCode = normalizeVipCode(code);
  if (!cleanCode) return null;

  const codes = cacheRead('vip_codes')?.data || {};
  return codes[cleanCode] || null;
}

export function getActiveVipCodeEntry(code) {
  const entry = getVipCodeEntry(code);
  if (!entry) return null;

  const now = Date.now();
  if (entry.expires_at && entry.expires_at < now) return null;

  return entry;
}

export function hasActiveVipCode(code) {
  return Boolean(getActiveVipCodeEntry(code));
}

export function getRequestVipCode(req) {
  return normalizeVipCode(
    req.headers['x-vip-code']
    || req.query?.vip_code
    || req.body?.vip_code
  );
}
