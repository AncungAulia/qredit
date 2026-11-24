import { ExpiringMap } from "./expiring.ts";

/** Memoise an async loader per key for ttlMs. Rejections are never cached; concurrent calls share one load. */
export function memoizeAsync<V>(
  load: (key: string) => Promise<V>,
  o: { ttlMs: number; maxEntries?: number; now?: () => number },
): (key: string) => Promise<V> {
  const now = o.now ?? Date.now;
  const cache = new ExpiringMap<V>(o.maxEntries ?? 1000, now);
  const inflight = new Map<string, Promise<V>>();
  return (key) => {
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit.value);
    const pending = inflight.get(key);
    if (pending) return pending;
    const p = load(key)
      .then((v) => {
        cache.set(key, v, now() + o.ttlMs);
        return v;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
