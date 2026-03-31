import { describe, it, expect } from "vitest";
import { Arena, type Id, type Poolable } from "./index.js";

class Point implements Poolable<Id<"Point">, [number, number]> {
  x!: number;
  y!: number;
  constructor() {}
  create(_id: Id<"Point">, x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Entity implements Poolable<Id<"Entity">, [string, number]> {
  name!: string;
  hp!: number;
  constructor() {}
  create(_id: Id<"Entity">, name: string, hp: number) {
    this.name = name;
    this.hp = hp;
  }
}

describe("Arena", () => {
  it("alloc and get", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const id = arena.alloc(10, 20);
    const p = arena.get(id);
    expect(p.x).toBe(10);
    expect(p.y).toBe(20);
    expect(arena.size).toBe(1);
  });

  it("multiple allocs", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const a = arena.alloc(1, 2);
    const b = arena.alloc(3, 4);
    const c = arena.alloc(5, 6);
    expect(arena.size).toBe(3);
    expect(arena.get(a).x).toBe(1);
    expect(arena.get(b).x).toBe(3);
    expect(arena.get(c).x).toBe(5);
  });

  it("free and reuse", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const a = arena.alloc(1, 2);
    const objA = arena.get(a);
    arena.free(a);
    expect(arena.size).toBe(0);

    const b = arena.alloc(10, 20);
    const objB = arena.get(b);
    // should reuse the same underlying object
    expect(objA).toBe(objB);
    expect(objB.x).toBe(10);
    expect(objB.y).toBe(20);
  });

  it("throws on access after free", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const id = arena.alloc(1, 2);
    arena.free(id);
    expect(() => arena.get(id)).toThrow("dead id");
  });

  it("throws on double free", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const id = arena.alloc(1, 2);
    arena.free(id);
    expect(() => arena.free(id)).toThrow("double free");
  });

  it("tryGet returns undefined for freed ids", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const id = arena.alloc(1, 2);
    arena.free(id);
    expect(arena.tryGet(id)).toBeUndefined();
  });

  it("tryGet returns value for live ids", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const id = arena.alloc(1, 2);
    expect(arena.tryGet(id)?.x).toBe(1);
  });

  it("isLive", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const id = arena.alloc(1, 2);
    expect(arena.isLive(id)).toBe(true);
    arena.free(id);
    expect(arena.isLive(id)).toBe(false);
  });

  it("clear resets all slots", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    const a = arena.alloc(1, 2);
    const b = arena.alloc(3, 4);
    arena.alloc(5, 6);
    expect(arena.size).toBe(3);

    arena.clear();
    expect(arena.size).toBe(0);
    expect(arena.capacity).toBe(3);
    expect(arena.isLive(a)).toBe(false);
    expect(arena.isLive(b)).toBe(false);

    // can realloc after clear
    const d = arena.alloc(7, 8);
    expect(arena.get(d).x).toBe(7);
    expect(arena.size).toBe(1);
  });

  it("pre-allocation via capacity", () => {
    const arena = new Arena<Id<"Point">, Point>(Point, { capacity: 5 });
    expect(arena.capacity).toBe(5);
    expect(arena.size).toBe(0);

    const id = arena.alloc(42, 99);
    expect(arena.get(id).x).toBe(42);
    expect(arena.size).toBe(1);
    expect(arena.capacity).toBe(5);
  });

  it("forEach skips freed slots", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    arena.alloc(1, 2);
    const b = arena.alloc(3, 4);
    arena.alloc(5, 6);
    arena.free(b);

    const seen: number[] = [];
    arena.forEach((p) => seen.push(p.x));
    expect(seen).toEqual([1, 5]);
  });

  it("iterator skips freed slots", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    arena.alloc(1, 2);
    const b = arena.alloc(3, 4);
    arena.alloc(5, 6);
    arena.free(b);

    const entries = [...arena];
    expect(entries.length).toBe(2);
    expect(entries[0]![1].x).toBe(1);
    expect(entries[1]![1].x).toBe(5);
  });

  it("forEach provides valid ids", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    arena.alloc(1, 2);
    arena.alloc(3, 4);

    arena.forEach((value, id) => {
      expect(arena.get(id)).toBe(value);
    });
  });

  it("iterator provides valid ids", () => {
    const arena = new Arena<Id<"Point">, Point>(Point);
    arena.alloc(1, 2);
    arena.alloc(3, 4);

    for (const [id, value] of arena) {
      expect(arena.get(id)).toBe(value);
    }
  });

  it("nominal types prevent cross-arena access at compile time", () => {
    const points = new Arena<Id<"Point">, Point>(Point);
    const entities = new Arena<Id<"Entity">, Entity>(Entity);

    const pid: Id<"Point"> = points.alloc(1, 2);
    const eid: Id<"Entity"> = entities.alloc("goblin", 50);

    points.get(pid);
    entities.get(eid);

    // These would fail at compile time:
    // points.get(eid);   // Type error!
    // entities.get(pid); // Type error!
    expect(true).toBe(true);
  });
});
