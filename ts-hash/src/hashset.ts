import type { Hasher } from "./hasher.js";

/**
 * A hash set backed by Map<string, T> where keys are hash strings.
 * Assumes no collisions (safe with 128-bit siphash for practical sizes).
 */
export class HashSet<T> {
  private _map = new Map<string, T>();
  private _hash: (value: T) => string;

  constructor(hash: (value: T) => string) {
    this._hash = hash;
  }

  get size(): number {
    return this._map.size;
  }

  has(value: T): boolean {
    return this._map.has(this._hash(value));
  }

  /**
   * Add a value to the set.
   * @returns true if the value was added (not already present).
   */
  add(value: T): boolean {
    const h = this._hash(value);
    if (this._map.has(h)) return false;
    this._map.set(h, value);
    return true;
  }

  /**
   * Add all elements from another HashSet.
   * @returns true if any new elements were added.
   */
  addAll(other: HashSet<T>): boolean {
    let changed = false;
    for (const value of other) {
      if (this.add(value)) changed = true;
    }
    return changed;
  }

  delete(value: T): boolean {
    return this._map.delete(this._hash(value));
  }

  clear(): void {
    this._map.clear();
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this._map.values();
  }

  toArray(): T[] {
    return [...this._map.values()];
  }

  forEach(fn: (value: T) => void): void {
    this._map.forEach(fn);
  }

  /** Hash the set itself — order-independent structural hash of its element hashes. */
  hashInto(h: Hasher): void {
    const keys = [...this._map.keys()].sort();
    h.u32(keys.length);
    for (const k of keys) h.str(k);
  }
}
