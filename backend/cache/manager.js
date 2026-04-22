/* ====================================================
   GOLIAT — Cache Manager Local
   Stocke les données en JSON local sur le serveur.
   Les clients lisent uniquement depuis ce cache —
   zéro appel API externe par utilisateur.
   ==================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, 'data');

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
  logger.info(`[Cache] Dossier créé: ${CACHE_DIR}`);
}

const FILES = {
  pronos:  join(CACHE_DIR, 'pronos.json'),    // Pronos du jour (free + VIP)
  matches: join(CACHE_DIR, 'matches.json'),   // Matchs bruts API-Football
  history: join(CACHE_DIR, 'history.json'),   // Historique des résultats
  stats:   join(CACHE_DIR, 'stats.json'),     // Stats globales (win rate, etc.)
};

/**
 * Read a cache file. Returns null if missing or corrupt.
 * @param {'pronos'|'matches'|'history'|'stats'} key
 */
export function cacheRead(key) {
  const file = FILES[key];
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    logger.warn(`[Cache] Lecture échouée (${key}):`, err.message);
    return null;
  }
}

/**
 * Write to a cache file atomically.
 * @param {'pronos'|'matches'|'history'|'stats'} key
 * @param {*} data
 */
export function cacheWrite(key, data) {
  const file = FILES[key];
  if (!file) return;
  try {
    const payload = {
      _meta: {
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString(), // 8h TTL
        count: Array.isArray(data) ? data.length : Object.keys(data).length
      },
      data
    };
    writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    logger.info(`[Cache] ✓ ${key} sauvegardé (${payload._meta.count} entrées)`);
  } catch (err) {
    logger.error(`[Cache] Écriture échouée (${key}):`, err.message);
  }
}

/**
 * Get cached data with freshness check.
 * @param {'pronos'|'matches'|'history'|'stats'} key
 * @param {number} maxAgeHours - max age in hours before considered stale
 * @returns {{ data: any, isStale: boolean, generatedAt: string } | null}
 */
export function cacheGet(key, maxAgeHours = 8) {
  const cached = cacheRead(key);
  if (!cached) return null;

  const generatedAt = new Date(cached._meta?.generated_at);
  const ageMs = Date.now() - generatedAt.getTime();
  const isStale = ageMs > maxAgeHours * 3600 * 1000;

  return {
    data: cached.data,
    isStale,
    generatedAt: cached._meta?.generated_at,
    count: cached._meta?.count
  };
}

/**
 * Check if cache exists and is fresh.
 * @param {'pronos'|'matches'|'history'|'stats'} key
 * @param {number} maxAgeHours
 */
export function isCacheFresh(key, maxAgeHours = 8) {
  const result = cacheGet(key, maxAgeHours);
  return result !== null && !result.isStale;
}

/**
 * Get cache info (for debug/health endpoint)
 */
export function getCacheInfo() {
  return Object.fromEntries(
    Object.entries(FILES).map(([key]) => {
      const cached = cacheRead(key);
      if (!cached) return [key, { exists: false }];
      const age = Math.round((Date.now() - new Date(cached._meta?.generated_at)) / 60000);
      return [key, {
        exists: true,
        generated_at: cached._meta?.generated_at,
        age_minutes: age,
        count: cached._meta?.count,
        is_fresh: age < 8 * 60
      }];
    })
  );
}
