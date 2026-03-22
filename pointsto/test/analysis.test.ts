import { describe, it, expect } from "vitest";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { analyze } from "../src/analysis.js";
import { Place, PossibleValues } from "../src/kleene.js";

function run(source: string): Map<Place, PossibleValues> {
  const program = parse(lex(source));
  return analyze(program);
}

/** find a Place by name in the result map */
function findPlace(
  state: Map<Place, PossibleValues>,
  name: string,
): [Place, PossibleValues] | undefined {
  for (const [place, values] of state) {
    if (place.name === name) return [place, values];
  }
  return undefined;
}

function expectObjects(
  state: Map<Place, PossibleValues>,
  placeName: string,
  ...labels: string[]
) {
  const found = findPlace(state, placeName);
  expect(found, `expected place "${placeName}" to exist`).toBeDefined();
  const objectNames = [...found![1].objects].map((o) => o.name).sort();
  expect(objectNames).toEqual(labels.sort());
}

function expectFunctions(
  state: Map<Place, PossibleValues>,
  placeName: string,
  ...labels: string[]
) {
  const found = findPlace(state, placeName);
  expect(found, `expected place "${placeName}" to exist`).toBeDefined();
  expect([...found![1].functions].map((f) => f.hash).sort()).toEqual(
    labels.sort(),
  );
}

describe("basic assignments", () => {
  it("tracks object allocation", () => {
    const state = run(`
      let a = {};
    `);
    expectObjects(state, "a", "obj@2");
  });

  it("tracks function allocation", () => {
    const state = run(`
      let f = () => { return null; };
    `);
    expectFunctions(state, "f", "fn@2");
  });

  it("tracks variable-to-variable flow", () => {
    const state = run(`
      let a = {};
      let b = a;
    `);
    expectObjects(state, "a", "obj@2");
    expectObjects(state, "b", "obj@2");
  });

  it("tracks multiple assignments (flow-insensitive)", () => {
    const state = run(`
      let a = {};
      let b = {};
      let x = a;
      x = b;
    `);
    expectObjects(state, "x", "obj@2", "obj@3");
  });
});

describe("object fields", () => {
  it("tracks field initialized in literal", () => {
    const state = run(`
      let f = () => { return null; };
      let obj = { handler: f };
      let g = obj.handler;
    `);
    expectFunctions(state, "g", "fn@2");
  });

  it("tracks field store then load", () => {
    const state = run(`
      let obj = {};
      let f = () => { return null; };
      obj.handler = f;
      let g = obj.handler;
    `);
    expectFunctions(state, "g", "fn@3");
  });

  it("distinguishes fields on the same object", () => {
    const state = run(`
      let a = () => { return null; };
      let b = () => { return null; };
      let obj = { x: a, y: b };
      let ra = obj.x;
      let rb = obj.y;
    `);
    expectFunctions(state, "ra", "fn@2");
    expectFunctions(state, "rb", "fn@3");
  });

  it("distinguishes fields on different objects", () => {
    const state = run(`
      let a = () => { return null; };
      let b = () => { return null; };
      let obj1 = { f: a };
      let obj2 = { f: b };
      let ra = obj1.f;
      let rb = obj2.f;
    `);
    expectFunctions(state, "ra", "fn@2");
    expectFunctions(state, "rb", "fn@3");
  });

  it("handles store after load (order independence)", () => {
    // flow-insensitive: load should still see the store
    const state = run(`
      let obj = {};
      let g = obj.handler;
      let f = () => { return null; };
      obj.handler = f;
    `);
    expectFunctions(state, "g", "fn@4");
  });

  it("handles nested field access", () => {
    const state = run(`
      let inner = { val: () => { return null; } };
      let outer = { nested: inner };
      let f = outer.nested.val;
    `);
    expectFunctions(state, "f", "fn@2");
  });
});

describe("multiple objects through one variable", () => {
  it("field load sees fields from all pointed-to objects", () => {
    const state = run(`
      let a = { f: () => { return null; } };
      let b = { f: () => { return null; } };
      let x = a;
      x = b;
      let result = x.f;
    `);
    // x points to both objects, so x.f should have both functions
    expectFunctions(state, "result", "fn@2", "fn@3");
  });

  it("field store writes to all pointed-to objects", () => {
    const state = run(`
      let a = {};
      let b = {};
      let x = a;
      x = b;
      let f = () => { return null; };
      x.handler = f;
      let ra = a.handler;
      let rb = b.handler;
    `);
    // both a and b should have handler set
    expectFunctions(state, "ra", "fn@6");
    expectFunctions(state, "rb", "fn@6");
  });
});
