import { describe, it, expect } from "vitest";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { analyze } from "../src/analysis.js";

function pointsTo(source: string): Map<string, Set<string>> {
  const program = parse(lex(source));
  return analyze(program);
}

// helper: check that variable `name` points to allocation sites with given labels
function expectPointsTo(result: Map<string, Set<string>>, name: string, ...targets: string[]) {
  const set = result.get(name);
  expect(set, `expected ${name} to exist in results`).toBeDefined();
  expect([...set!].sort()).toEqual(targets.sort());
}

describe("direct assignments", () => {
  it("tracks a single closure", () => {
    const r = pointsTo(`
      let f = () => { return 1; };
    `);
    expectPointsTo(r, "f", "fn@2");
  });

  it("tracks object allocation", () => {
    const r = pointsTo(`
      let o = { x: 1 };
    `);
    expectPointsTo(r, "o", "obj@2");
  });

  it("tracks variable-to-variable copy", () => {
    const r = pointsTo(`
      let f = () => { return 1; };
      let g = f;
    `);
    expectPointsTo(r, "f", "fn@2");
    expectPointsTo(r, "g", "fn@2");
  });
});

describe("field sensitivity", () => {
  it("tracks function stored in object field", () => {
    const r = pointsTo(`
      let handler = (x) => { return x; };
      let obj = { f: handler };
      let g = obj.f;
    `);
    expectPointsTo(r, "g", "fn@2");
  });

  it("tracks field assignment after construction", () => {
    const r = pointsTo(`
      let obj = {};
      let handler = (x) => { return x; };
      obj.f = handler;
      let g = obj.f;
    `);
    expectPointsTo(r, "g", "fn@3");
  });

  it("tracks nested field access", () => {
    const r = pointsTo(`
      let inner = { val: () => { return 1; } };
      let outer = { nested: inner };
      let f = outer.nested.val;
    `);
    expectPointsTo(r, "f", "fn@2");
  });
});

describe("call graph discovery", () => {
  it("discovers direct call return value", () => {
    const r = pointsTo(`
      let make = () => {
        return () => { return 1; };
      };
      let f = make();
    `);
    expectPointsTo(r, "f", "fn@3");
  });

  it("discovers higher-order function call", () => {
    const r = pointsTo(`
      let apply = (f, x) => {
        return f(x);
      };
      let id = (x) => { return x; };
      let obj = {};
      let result = apply(id, obj);
    `);
    expectPointsTo(r, "result", "obj@6");
  });

  it("discovers multi-step call chain", () => {
    const r = pointsTo(`
      let wrap = (x) => {
        return { val: x };
      };
      let unwrap = (o) => {
        return o.val;
      };
      let f = () => { return 1; };
      let w = wrap(f);
      let g = unwrap(w);
    `);
    expectPointsTo(r, "g", "fn@8");
  });
});

describe("closures and captures", () => {
  it("tracks captured variable through closure", () => {
    const r = pointsTo(`
      let x = {};
      let f = () => { return x; };
      let result = f();
    `);
    expectPointsTo(r, "result", "obj@2");
  });

  it("tracks factory pattern (makeAdder style)", () => {
    const r = pointsTo(`
      let makeHandler = (h) => {
        return () => { return h; };
      };
      let myFn = () => { return 1; };
      let wrapped = makeHandler(myFn);
      let result = wrapped();
    `);
    expectPointsTo(r, "result", "fn@5");
  });
});

describe("branches", () => {
  it("merges points-to sets from both branches", () => {
    const r = pointsTo(`
      let a = () => { return 1; };
      let b = () => { return 2; };
      let f;
      if (true) {
        f = a;
      } else {
        f = b;
      }
    `);
    expectPointsTo(r, "f", "fn@2", "fn@3");
  });

  it("handles conditional call targets", () => {
    const r = pointsTo(`
      let a = (x) => { return x; };
      let b = (x) => { return x; };
      let f;
      if (true) {
        f = a;
      } else {
        f = b;
      }
      let obj = {};
      let result = f(obj);
    `);
    expectPointsTo(r, "result", "obj@10");
  });
});

describe("loops", () => {
  it("reaches fixpoint through loop", () => {
    const r = pointsTo(`
      let a = {};
      let b = {};
      let x = a;
      loop {
        x = b;
        break;
      }
    `);
    expectPointsTo(r, "x", "obj@2", "obj@3");
  });

  it("handles function built in a loop", () => {
    const r = pointsTo(`
      let last;
      loop {
        last = () => { return 1; };
        break;
      }
    `);
    // last should point to the closure allocated inside the loop
    const set = pointsTo(`
      let last;
      loop {
        last = () => { return 1; };
        break;
      }
    `).get("last");
    expect(set).toBeDefined();
    expect(set!.size).toBeGreaterThan(0);
  });
});

describe("mutual recursion", () => {
  it("discovers mutually recursive call graph", () => {
    const r = pointsTo(`
      let isEven;
      let isOdd;
      isEven = (n) => {
        if (n == 0) { return {}; }
        return isOdd(n - 1);
      };
      isOdd = (n) => {
        if (n == 0) { return {}; }
        return isEven(n - 1);
      };
      let result = isEven(4);
    `);
    // result should point to the object literals in both functions
    const set = r.get("result");
    expect(set).toBeDefined();
    expect(set!.size).toBeGreaterThan(0);
  });
});

describe("forward declarations", () => {
  it("handles forward-declared function", () => {
    const r = pointsTo(`
      let f;
      let result = f();
      f = () => { return {}; };
    `);
    // after fixpoint iteration, f() should resolve
    const set = r.get("result");
    expect(set).toBeDefined();
    expect(set!.size).toBeGreaterThan(0);
  });
});

describe("multi-step discovery", () => {
  it("discovers call target through field read after call graph update", () => {
    // Step 1: analyze getHandler, discover it returns an object
    // Step 2: discover result.f points to the closure
    // Step 3: discover result.f() calls that closure
    const r = pointsTo(`
      let getHandler = () => {
        return { f: (x) => { return x; } };
      };
      let result = getHandler();
      let obj = {};
      let out = result.f(obj);
    `);
    expectPointsTo(r, "out", "obj@5");
  });

  it("discovers call target through two levels of indirection", () => {
    const r = pointsTo(`
      let make = () => {
        return (x) => { return x; };
      };
      let apply = (f, x) => {
        return f(x);
      };
      let fn = make();
      let obj = {};
      let result = apply(fn, obj);
    `);
    expectPointsTo(r, "result", "obj@8");
  });

  it("callback passed through multiple hops", () => {
    const r = pointsTo(`
      let a = (cb) => {
        return b(cb);
      };
      let b = (cb) => {
        return cb();
      };
      let target = {};
      let result = a(() => { return target; });
    `);
    expectPointsTo(r, "result", "obj@7");
  });
});

describe("tree recursion", () => {
  it("handles tree-like recursive structure", () => {
    const r = pointsTo(`
      let makeNode = (l, r) => {
        return { left: l, right: r };
      };
      let leaf = {};
      let tree = makeNode(makeNode(leaf, leaf), leaf);
      let leftLeft = tree.left.left;
    `);
    expectPointsTo(r, "leftLeft", "obj@5");
  });
});
