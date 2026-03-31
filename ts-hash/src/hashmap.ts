import type { Hasher } from "./hasher.js";

/**
 * A hash map backed by Map<string, {key, value}> where string keys are hash strings.
 * Assumes no collisions (safe with 128-bit siphash for practical sizes).
 */
export class HashMap<K, V> {
  private _map = new Map<string, { key: K; value: V }>();
  private _hash: (key: K) => string;

  constructor(hash: (key: K) => string) {
    this._hash = hash;
  }

  get size(): number {
    return this._map.size;
  }

  has(key: K): boolean {
    return this._map.has(this._hash(key));
  }

  get(key: K): V | undefined {
    return this._map.get(this._hash(key))?.value;
  }

  /**
   * Set a key-value pair.
   * @returns true if the key was new, false if it was updated.
   */
  set(key: K, value: V): boolean {
    const h = this._hash(key);
    const isNew = !this._map.has(h);
    this._map.set(h, { key, value });
    return isNew;
  }

  /**
   * Get or create a value for a key.
   */
  getOrInsert(key: K, factory: () => V): V {
    const h = this._hash(key);
    const existing = this._map.get(h);
    if (existing) return existing.value;
    const value = factory();
    this._map.set(h, { key, value });
    return value;
  }

  delete(key: K): boolean {
    return this._map.delete(this._hash(key));
  }

  clear(): void {
    this._map.clear();
  }

  *[Symbol.iterator](): Iterator<[K, V]> {
    for (const { key, value } of this._map.values()) {
      yield [key, value];
    }
  }

  *keys(): Iterator<K> {
    for (const { key } of this._map.values()) {
      yield key;
    }
  }

  *values(): Iterator<V> {
    for (const { value } of this._map.values()) {
      yield value;
    }
  }

  forEach(fn: (value: V, key: K) => void): void {
    for (const { key, value } of this._map.values()) {
      fn(value, key);
    }
  }

  /** Hash the map itself — order-independent structural hash of key-value pairs. */
  hashInto(h: Hasher, hashValue: (v: V, h: Hasher) => void): void {
    // sort by key hash for order independence, then hash each key-value pair
    const entries = [...this._map.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    h.u32(entries.length);
    for (const [keyHash, { value }] of entries) {
      h.str(keyHash);
      hashValue(value, h);
    }
  }
}
