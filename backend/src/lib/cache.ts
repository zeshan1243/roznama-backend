import NodeCache from 'node-cache';

/**
 * Simple TTL cache used to shield upstream sources from request volume and to
 * keep responses snappy. Each domain picks its own TTL (see callers).
 */
const store = new NodeCache({ checkperiod: 120 });

/**
 * Returns a cached value for `key`, or computes it via `producer`, caches it
 * for `ttlSeconds`, and returns it. On producer failure, falls back to any
 * stale cached value if present (so a flaky upstream never blanks the UI).
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
): Promise<T> {
  const hit = store.get<T>(key);
  if (hit !== undefined) return hit;
  try {
    const value = await producer();
    store.set(key, value, ttlSeconds);
    return value;
  } catch (err) {
    const stale = store.get<T>(`${key}:stale`);
    if (stale !== undefined) return stale;
    throw err;
  }
}

/** Store a long-lived stale copy that `cached` can fall back to on failure. */
export function keepStale<T>(key: string, value: T): void {
  store.set(`${key}:stale`, value, 60 * 60 * 24 * 7);
}
