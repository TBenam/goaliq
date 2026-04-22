/* ====================================================
   GOLIAT — In-Memory Cache
   Simple TTL cache to avoid redundant Firestore reads
   ==================================================== */

const cache = new Map();

/**
 * Get value from cache
 * @param {string} key
 * @returns {*|null} value or null if expired/missing
 */
export function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Set value in cache with TTL
 * @param {string} key
 * @param {*}      value
 * @param {number} ttlSeconds - default 300s (5 min)
 */
export function cacheSet(key, value, ttlSeconds = 300) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
    createdAt: Date.now()
  });
}

/** Delete from cache */
export function cacheDel(key) { cache.delete(key); }

/** Clear entire cache */
export function cacheClear() { cache.clear(); }

/** Cache-through: returns cached value or fetches it */
export async function cacheThrough(key, fetchFn, ttlSeconds = 300) {
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  const value = await fetchFn();
  if (value !== null && value !== undefined) cacheSet(key, value, ttlSeconds);
  return value;
}

/** Middleware: adds cache helpers to req */
export function cacheMiddleware(req, res, next) {
  req.cache = { get: cacheGet, set: cacheSet, del: cacheDel, through: cacheThrough };
  next();
}
