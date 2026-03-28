/**
 * ts-arena — Typed object pooling with nominal indices
 *
 * Arena'd classes must satisfy:
 *   constructor() {}        // blank — arena manages allocation
 *   create(...args) {}      // initializer — must assign all fields
 *
 * Ids are plain slot indices (just numbers). Liveness tracked via bitset.
 */

import { BitSet } from "./bitset.js";

// ---- Nominal index types ----

declare const __brand: unique symbol;

/**
 * A nominal index type. Compiles to `number` at runtime.
 *
 * Usage:
 *   type PointId = Id<"Point">;
 *   const arena = new Arena<PointId, Point>(Point);
 */
export type Id<Brand extends string> = number & { readonly [__brand]: Brand };

// ---- Poolable interface ----

/**
 * Any class that can be arena-managed must have:
 * - A no-arg constructor
 * - A `create` method that initializes all fields
 */
export interface Poolable<Args extends unknown[] = unknown[]> {
  create(...args: Args): void;
}

export type PoolableConstructor<T extends Poolable> = new () => T;

// ---- Arena options ----

export interface ArenaOptions {
  /** Pre-allocate this many slots up front */
  capacity?: number;
}

// ---- Arena ----

export class Arena<I extends Id<string>, T extends Poolable> {
  private pool: T[] = [];
  private live: BitSet = new BitSet();
  private freelist: number[] = [];
  private count = 0;

  constructor(
    private ctor: PoolableConstructor<T>,
    options?: ArenaOptions,
  ) {
    if (options?.capacity) {
      const cap = options.capacity;
      this.pool.length = cap;
      this.live = new BitSet(cap);
      for (let i = 0; i < cap; i++) {
        this.pool[i] = new this.ctor();
        this.freelist.push(i);
      }
      this.count = cap;
    }
  }

  /**
   * Allocate a new object (or recycle a freed one) and initialize it.
   */
  alloc(...args: Parameters<T["create"]>): I {
    let slot: number;
    let obj: T;

    if (this.freelist.length > 0) {
      slot = this.freelist.pop()!;
      obj = this.pool[slot]!;
    } else {
      slot = this.count++;
      obj = new this.ctor();
      this.pool.push(obj);
    }

    this.live.add(slot);
    obj.create(...args);
    return slot as unknown as I;
  }

  /**
   * Get the object at the given index. Throws if freed.
   */
  get(id: I): T {
    if (!this.live.has(id as number)) {
      throw new Error(`arena access on dead id: ${id}`);
    }
    return this.pool[id as number]!;
  }

  /**
   * Get the object at the given index, or undefined if freed.
   */
  tryGet(id: I): T | undefined {
    if (!this.live.has(id as number)) return undefined;
    return this.pool[id as number];
  }

  /**
   * Returns true if the given id is currently live.
   */
  isLive(id: I): boolean {
    return this.live.has(id as number);
  }

  /**
   * Free the object at the given index for reuse.
   */
  free(id: I): void {
    if (!this.live.has(id as number)) {
      throw new Error(`double free on arena id: ${id}`);
    }
    this.live.remove(id as number);
    this.freelist.push(id as number);
  }

  /**
   * Free all objects and reset the arena. Pool memory is retained.
   */
  clear(): void {
    this.freelist.length = 0;
    this.live.clear();
    for (let i = 0; i < this.count; i++) {
      this.freelist.push(i);
    }
  }

  /**
   * Number of live (allocated and not freed) objects.
   */
  get size(): number {
    return this.count - this.freelist.length;
  }

  /**
   * Total capacity (live + freed slots).
   */
  get capacity(): number {
    return this.count;
  }

  /**
   * Call a function for each live object.
   */
  forEach(fn: (value: T, id: I) => void): void {
    for (let i = 0; i < this.count; i++) {
      if (this.live.has(i)) {
        fn(this.pool[i]!, i as unknown as I);
      }
    }
  }

  /**
   * Iterate over all live (id, value) pairs.
   */
  [Symbol.iterator](): Iterator<[I, T]> {
    let i = 0;
    const pool = this.pool;
    const live = this.live;
    const count = this.count;
    return {
      next(): IteratorResult<[I, T]> {
        while (i < count) {
          const idx = i++;
          if (live.has(idx)) {
            return {
              done: false,
              value: [idx as unknown as I, pool[idx]!],
            };
          }
        }
        return { done: true, value: undefined };
      },
    };
  }
}

export { BitSet } from "./bitset.js";
