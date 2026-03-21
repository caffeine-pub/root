import { describe, it, expect } from "vitest";
import { HashSet } from "../src/hashset.js";
import { HashMap } from "../src/hashmap.js";

const identity = (s: string) => s;

type Point = { x: number; y: number };
const pointHash = (p: Point) => `${p.x},${p.y}`;

describe("HashSet", () => {
  it("adds and checks membership", () => {
    const s = new HashSet(identity);
    expect(s.add("a")).toBe(true);
    expect(s.add("b")).toBe(true);
    expect(s.has("a")).toBe(true);
    expect(s.has("b")).toBe(true);
    expect(s.has("c")).toBe(false);
    expect(s.size).toBe(2);
  });

  it("rejects duplicates", () => {
    const s = new HashSet(identity);
    expect(s.add("a")).toBe(true);
    expect(s.add("a")).toBe(false);
    expect(s.size).toBe(1);
  });

  it("deletes elements", () => {
    const s = new HashSet(identity);
    s.add("a");
    s.add("b");
    expect(s.delete("a")).toBe(true);
    expect(s.has("a")).toBe(false);
    expect(s.has("b")).toBe(true);
    expect(s.size).toBe(1);
  });

  it("iterates", () => {
    const s = new HashSet(identity);
    s.add("a");
    s.add("b");
    s.add("c");
    expect(s.toArray().sort()).toEqual(["a", "b", "c"]);
  });

  it("addAll returns whether anything changed", () => {
    const a = new HashSet(identity);
    a.add("x");
    a.add("y");

    const b = new HashSet(identity);
    b.add("y");
    b.add("z");

    expect(a.addAll(b)).toBe(true);
    expect(a.size).toBe(3);
    expect(a.addAll(b)).toBe(false);
  });

  it("works with structural keys", () => {
    const s = new HashSet(pointHash);
    expect(s.add({ x: 1, y: 2 })).toBe(true);
    expect(s.add({ x: 1, y: 2 })).toBe(false);
    expect(s.add({ x: 3, y: 4 })).toBe(true);
    expect(s.has({ x: 1, y: 2 })).toBe(true);
    expect(s.size).toBe(2);
  });

  it("handles many elements", () => {
    const s = new HashSet(identity);
    for (let i = 0; i < 100; i++) {
      s.add(`item${i}`);
    }
    expect(s.size).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(s.has(`item${i}`)).toBe(true);
    }
  });

  it("clears", () => {
    const s = new HashSet(identity);
    s.add("a");
    s.add("b");
    s.clear();
    expect(s.size).toBe(0);
    expect(s.has("a")).toBe(false);
  });
});

describe("HashMap", () => {
  it("sets and gets", () => {
    const m = new HashMap(identity);
    m.set("a", 1);
    m.set("b", 2);
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBe(2);
    expect(m.get("c")).toBeUndefined();
    expect(m.size).toBe(2);
  });

  it("overwrites existing keys", () => {
    const m = new HashMap(identity);
    expect(m.set("a", 1)).toBe(true);
    expect(m.set("a", 2)).toBe(false);
    expect(m.get("a")).toBe(2);
    expect(m.size).toBe(1);
  });

  it("deletes", () => {
    const m = new HashMap(identity);
    m.set("a", 1);
    m.set("b", 2);
    expect(m.delete("a")).toBe(true);
    expect(m.has("a")).toBe(false);
    expect(m.get("b")).toBe(2);
    expect(m.size).toBe(1);
  });

  it("iterates entries", () => {
    const m = new HashMap(identity);
    m.set("a", 1);
    m.set("b", 2);
    const entries = [...m].sort(([a], [b]) => a.localeCompare(b));
    expect(entries).toEqual([["a", 1], ["b", 2]]);
  });

  it("getOrInsert", () => {
    const m = new HashMap(identity);
    const v1 = m.getOrInsert("a", () => 42);
    expect(v1).toBe(42);
    const v2 = m.getOrInsert("a", () => 99);
    expect(v2).toBe(42);
    expect(m.size).toBe(1);
  });

  it("works with structural keys", () => {
    const m = new HashMap(pointHash);
    m.set({ x: 1, y: 2 }, "hello");
    expect(m.get({ x: 1, y: 2 })).toBe("hello");
    expect(m.get({ x: 3, y: 4 })).toBeUndefined();
  });

  it("handles many elements", () => {
    const m = new HashMap(identity);
    for (let i = 0; i < 100; i++) {
      m.set(`key${i}`, i);
    }
    expect(m.size).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(m.get(`key${i}`)).toBe(i);
    }
  });
});
