import { describe, it, expect } from "vitest";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { analyze } from "../src/analysis.js";
import { type PlaceId, PossibleValues, places, objects } from "../src/kleene.js";

function run(source: string): Map<PlaceId, PossibleValues> {
  const program = parse(lex(source));
  return analyze(program);
}

/** find a PlaceId by name in the result map */
function findPlace(
  state: Map<PlaceId, PossibleValues>,
  name: string,
): [PlaceId, PossibleValues] | undefined {
  for (const [placeId, values] of state) {
    if (places.get(placeId).name === name) return [placeId, values];
  }
  return undefined;
}

function expectObjects(
  state: Map<PlaceId, PossibleValues>,
  placeName: string,
  ...labels: string[]
) {
  const found = findPlace(state, placeName);
  expect(found, `expected place "${placeName}" to exist`).toBeDefined();
  const objectNames = [...found![1].objects].map((id) => objects.get(id).name).sort();
  expect(objectNames).toEqual(labels.sort());
}

function expectFunctions(
  state: Map<PlaceId, PossibleValues>,
  placeName: string,
  ...labels: string[]
) {
  const found = findPlace(state, placeName);
  expect(found, `expected place "${placeName}" to exist`).toBeDefined();
  expect([...found![1].functions].map((f) => 'expr' in f ? f.expr.label : f.label).sort()).toEqual(
    labels.sort(),
  );
}

describe("basic assignments", () => {
  it("tracks object allocation", () => {
    const state = run(`
      let a = 'a: {};
    `);
    expectObjects(state, "a", "a");
  });

  it("tracks function allocation", () => {
    const state = run(`
      let f = 'f: () => { return null; };
    `);
    expectFunctions(state, "f", "f");
  });

  it("tracks variable-to-variable flow", () => {
    const state = run(`
      let a = 'a: {};
      let b = a;
    `);
    expectObjects(state, "a", "a");
    expectObjects(state, "b", "a");
  });

  it("tracks multiple assignments (flow-insensitive)", () => {
    const state = run(`
      let a = 'a: {};
      let b = 'b: {};
      let x = a;
      x = b;
    `);
    expectObjects(state, "x", "a", "b");
  });
});

describe("object fields", () => {
  it("tracks field initialized in literal", () => {
    const state = run(`
      let f = 'f: () => { return null; };
      let obj = 'obj: { handler: f };
      let g = obj.handler;
    `);
    expectFunctions(state, "g", "f");
  });

  it("tracks field store then load", () => {
    const state = run(`
      let obj = 'obj: {};
      let f = 'f: () => { return null; };
      obj.handler = f;
      let g = obj.handler;
    `);
    expectFunctions(state, "g", "f");
  });

  it("distinguishes fields on the same object", () => {
    const state = run(`
      let a = 'a: () => { return null; };
      let b = 'b: () => { return null; };
      let obj = 'obj: { x: a, y: b };
      let ra = obj.x;
      let rb = obj.y;
    `);
    expectFunctions(state, "ra", "a");
    expectFunctions(state, "rb", "b");
  });

  it("distinguishes fields on different objects", () => {
    const state = run(`
      let a = 'a: () => { return null; };
      let b = 'b: () => { return null; };
      let obj1 = 'obj1: { f: a };
      let obj2 = 'obj2: { f: b };
      let ra = obj1.f;
      let rb = obj2.f;
    `);
    expectFunctions(state, "ra", "a");
    expectFunctions(state, "rb", "b");
  });

  it("handles store after load (order independence)", () => {
    // flow-insensitive: load should still see the store
    const state = run(`
      let obj = 'obj: {};
      let g = obj.handler;
      let f = 'f: () => { return null; };
      obj.handler = f;
    `);
    expectFunctions(state, "g", "f");
  });

  it("handles nested field access", () => {
    const state = run(`
      let inner = 'inner: { val: 'v: () => { return null; } };
      let outer = 'outer: { nested: inner };
      let f = outer.nested.val;
    `);
    expectFunctions(state, "f", "v");
  });
});

describe("multiple objects through one variable", () => {
  it("field load sees fields from all pointed-to objects", () => {
    const state = run(`
      let a = 'a: { f: 'af: () => { return null; } };
      let b = 'b: { f: 'bf: () => { return null; } };
      let x = a;
      x = b;
      let result = x.f;
    `);
    // x points to both objects, so x.f should have both functions
    expectFunctions(state, "result", "af", "bf");
  });

  it("field store writes to all pointed-to objects", () => {
    const state = run(`
      let a = 'a: {};
      let b = 'b: {};
      let x = a;
      x = b;
      let f = 'f: () => { return null; };
      x.handler = f;
      let ra = a.handler;
      let rb = b.handler;
    `);
    // both a and b should have handler set
    expectFunctions(state, "ra", "f");
    expectFunctions(state, "rb", "f");
  });
});

describe("duplicate call sites", () => {
  it("two calls to same function with same arg produce independent results", () => {
    const state = run(`
      let id = 'id: (x) => { return x; };
      let obj1 = 'o1: {};
      let obj2 = 'o2: {};
      let a = id(obj1);
      let b = id(obj2);
    `);
    // a should get o1 only, b should get o2 only
    expectObjects(state, "a", "o1");
    expectObjects(state, "b", "o2");
  });

  it("two calls with same arg still wire return values independently", () => {
    const state = run(`
      let make = 'make: (x) => { return 'inner: { val: x }; };
      let obj = 'obj: {};
      let a = make(obj);
      let b = make(obj);
      let av = a.val;
      let bv = b.val;
    `);
    // both a and b should get inner objects, both should have val → obj
    expectObjects(state, "av", "obj");
    expectObjects(state, "bv", "obj");
  });
});
