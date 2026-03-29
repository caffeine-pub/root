import { describe, it, expect } from "vitest";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { analyze } from "../src/analysis.js";
import { Place, PossibleValues } from "../src/kleene.js";

function pointsTo(source: string): Map<string, Set<string>> {
  const program = parse(lex(source));
  const raw = analyze(program);
  const result = new Map<string, Set<string>>();
  for (const [place, values] of raw) {
    const labels = new Set<string>();
    for (const obj of values.objects) labels.add(obj.name);
    for (const fn of values.functions) labels.add(fn.hash);
    if (labels.size > 0) result.set(place.name, labels);
  }
  return result;
}

// helper: check that variable `name` points to allocation sites with given labels
function expectPointsTo(
  result: Map<string, Set<string>>,
  name: string,
  ...targets: string[]
) {
  const set = result.get(name);
  expect(set, `expected ${name} to exist in results`).toBeDefined();
  expect([...set!].sort()).toEqual(targets.sort());
}

describe("direct assignments", () => {
  it("tracks a single closure", () => {
    const r = pointsTo(`
      let f = 'f: () => { return 'o: {}; };
    `);
    expectPointsTo(r, "f", "f");
  });

  it("tracks object allocation", () => {
    const r = pointsTo(`
      let o = 'o: { x: null };
    `);
    expectPointsTo(r, "o", "o");
  });

  it("tracks variable-to-variable copy", () => {
    const r = pointsTo(`
      let f = 'f: () => { return 'o: {}; };
      let g = f;
    `);
    expectPointsTo(r, "f", "f");
    expectPointsTo(r, "g", "f");
  });
});

describe("field sensitivity", () => {
  it("tracks function stored in object field", () => {
    const r = pointsTo(`
      let handler = 'handler: (x) => { return x; };
      let obj = 'obj: { f: handler };
      let g = obj.f;
    `);
    expectPointsTo(r, "g", "handler");
  });

  it("tracks field assignment after construction", () => {
    const r = pointsTo(`
      let obj = 'obj: {};
      let handler = 'handler: (x) => { return x; };
      obj.f = handler;
      let g = obj.f;
    `);
    expectPointsTo(r, "g", "handler");
  });

  it("tracks nested field access", () => {
    const r = pointsTo(`
      let inner = 'inner: { val: 'v: () => { return 'o: {}; } };
      let outer = 'outer: { nested: inner };
      let f = outer.nested.val;
    `);
    expectPointsTo(r, "f", "v");
  });
});

describe("call graph discovery", () => {
  it("discovers direct call return value", () => {
    const r = pointsTo(`
      let make = 'make: () => {
        return 'inner: () => { return 'o: {}; };
      };
      let f = make();
    `);
    expectPointsTo(r, "f", "inner");
  });

  it("discovers higher-order function call", () => {
    const r = pointsTo(`
      let apply = 'apply: (f, x) => {
        return f(x);
      };
      let id = 'id: (x) => { return x; };
      let obj = 'obj: {};
      let result = apply(id, obj);
    `);
    expectPointsTo(r, "result", "obj");
  });

  it("discovers multi-step call chain", () => {
    const r = pointsTo(`
      let wrap = 'wrap: (x) => {
        return 'w: { val: x };
      };
      let unwrap = 'unwrap: (o) => {
        return o.val;
      };
      let f = 'f: () => { return 'o: {}; };
      let w = wrap(f);
      let g = unwrap(w);
    `);
    expectPointsTo(r, "g", "f");
  });
});

describe("closures and captures", () => {
  it("tracks captured variable through closure", () => {
    const r = pointsTo(`
      let x = 'x: {};
      let f = 'f: () => { return x; };
      let result = f();
    `);
    expectPointsTo(r, "result", "x");
  });

  it("tracks factory pattern", () => {
    const r = pointsTo(`
      let makeHandler = 'makeHandler: (h) => {
        return 'inner: () => { return h; };
      };
      let myFn = 'myFn: () => { return 'o: {}; };
      let wrapped = makeHandler(myFn);
      let result = wrapped();
    `);
    expectPointsTo(r, "result", "myFn");
  });
});

describe("branches", () => {
  it("merges points-to sets from both branches", () => {
    const r = pointsTo(`
      let a = 'a: () => { return 'o: {}; };
      let b = 'b: () => { return 'o2: {}; };
      let f = null;
      if {
        f = a;
      } else {
        f = b;
      }
    `);
    expectPointsTo(r, "f", "a", "b");
  });

  it("handles conditional call targets", () => {
    const r = pointsTo(`
      let a = 'a: (x) => { return x; };
      let b = 'b: (x) => { return x; };
      let f = null;
      if {
        f = a;
      } else {
        f = b;
      }
      let obj = 'obj: {};
      let result = f(obj);
    `);
    expectPointsTo(r, "result", "obj");
  });
});

describe("loops", () => {
  it("reaches fixpoint through loop", () => {
    const r = pointsTo(`
      let a = 'a: {};
      let b = 'b: {};
      let x = a;
      loop {
        x = b;
        break;
      }
    `);
    expectPointsTo(r, "x", "a", "b");
  });

  it("handles function built in a loop", () => {
    const r = pointsTo(`
      let last = null;
      loop {
        last = 'f: () => { return 'o: {}; };
        break;
      }
    `);
    const set = r.get("last");
    expect(set).toBeDefined();
    expect(set!.size).toBeGreaterThan(0);
  });
});

describe("mutual recursion", () => {
  it("discovers mutually recursive call graph", () => {
    const r = pointsTo(`
      let isEven = null;
      let isOdd = null;
      isEven = 'isEven: (n) => {
        let r = isOdd(n);
        return n;
      };
      isOdd = 'isOdd: (n) => {
        let r = isEven(n);
        return n;
      };
      let obj = 'obj: {};
      let result = isEven(obj);
    `);
    // obj flows into isEven.n, then into isOdd.n via the call,
    // and both functions return n, so result gets obj
    expectPointsTo(r, "result", "obj");
  });
});

describe("forward declarations", () => {
  it("handles forward-declared function", () => {
    const r = pointsTo(`
      let f = null;
      let result = f();
      f = 'f: () => { return 'o: {}; };
    `);
    const set = r.get("result");
    expect(set).toBeDefined();
    expect(set!.size).toBeGreaterThan(0);
  });
});

describe("multi-step discovery", () => {
  it("discovers call target through field read after call graph update", () => {
    const r = pointsTo(`
      let getHandler = 'getHandler: () => {
        return 'obj: { f: 'handler: (x) => { return x; } };
      };
      let result = getHandler();
      let obj = 'obj2: {};
      let out = result.f(obj);
    `);
    expectPointsTo(r, "out", "obj2");
  });

  it("discovers call target through two levels of indirection", () => {
    const r = pointsTo(`
      let make = 'make: () => {
        return 'id: (x) => { return x; };
      };
      let apply = 'apply: (f, x) => {
        return f(x);
      };
      let fn = make();
      let obj = 'obj: {};
      let result = apply(fn, obj);
    `);
    expectPointsTo(r, "result", "obj");
  });

  it("callback passed through multiple hops", () => {
    const r = pointsTo(`
      let a = 'a: (cb) => {
        return b(cb);
      };
      let b = 'b: (cb) => {
        return cb();
      };
      let target = 'target: {};
      let result = a('cb: () => { return target; });
    `);
    expectPointsTo(r, "result", "target");
  });
});

describe("tree recursion", () => {
  it("handles tree-like recursive structure", () => {
    const r = pointsTo(`
      let makeNode = 'makeNode: (l, r) => {
        return 'node: { left: l, right: r };
      };
      let leaf = 'leaf: {};
      let tree = makeNode(makeNode(leaf, leaf), leaf);
      let leftLeft = tree.left.left;
    `);
    expectPointsTo(r, "leftLeft", "leaf");
  });
});
