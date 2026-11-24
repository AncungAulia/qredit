/** A bounded map whose entries expire at a given time. Shared by the rate limiter and the key cache. */
export type Entry<V> = { value: V; expiresAt: number };

export class ExpiringMap<V> {
  private readonly map = new Map<string, Entry<V>>();

  constructor(private readonly maxEntries: number, private readonly now: () => number = Date.now) {}

  get(key: string): Entry<V> | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  set(key: string, value: V, expiresAt: number): void {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) this.evict();
    this.map.set(key, { value, expiresAt });
  }

  get size(): number {
    return this.map.size;
  }

  /** Drop every expired entry; if the map is still full, drop the oldest inserted. */
  private evict(): void {
    const t = this.now();
    for (const [k, e] of this.map) if (e.expiresAt <= t) this.map.delete(k);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }
}
