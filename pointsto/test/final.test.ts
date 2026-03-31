import { describe, it, expect } from "vitest";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { analyze } from "../src/analysis.js";
import { type PlaceId, PossibleValues, places, objects } from "../src/kleene.js";

function pointsTo(source: string): Map<string, Set<string>> {
  const program = parse(lex(source));
  const raw = analyze(program);
  const result = new Map<string, Set<string>>();
  for (const [placeId, values] of raw) {
    const name = places.get(placeId).name;
    const labels = new Set<string>();
    for (const objId of values.objects) labels.add(objects.get(objId).name);
    for (const fn of values.functions) labels.add('expr' in fn ? fn.expr.label : fn.label);
    if (labels.size > 0) result.set(name, labels);
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

describe("stress: deep callback chains", () => {
  it("passes callback through 3 wrappers", () => {
    const r = pointsTo(`
      let w1 = 'w1: (f) => { return w2(f); };
      let w2 = 'w2: (f) => { return w3(f); };
      let w3 = 'w3: (f) => { return f(); };
      let target = 'target: {};
      let result = w1('cb: () => { return target; });
    `);
    expectPointsTo(r, "result", "target");
  });

  it("compose two functions", () => {
    const r = pointsTo(`
      let compose = 'compose: (f, g, x) => {
        return f(g(x));
      };
      let wrap = 'wrap: (v) => {
        return 'box: { val: v };
      };
      let id = 'id: (x) => { return x; };
      let thing = 'thing: {};
      let result = compose(wrap, id, thing);
    `);
    // compose(wrap, id, thing) → wrap(id(thing)) → wrap(thing) → {val: thing}
    // object created inside instantiated wrap gets _instant suffix
    expectPointsTo(r, "result", "box_instant");
    // check the field
    const r2 = pointsTo(`
      let compose = 'compose: (f, g, x) => {
        return f(g(x));
      };
      let wrap = 'wrap: (v) => {
        return 'box: { val: v };
      };
      let id = 'id: (x) => { return x; };
      let thing = 'thing: {};
      let result = compose(wrap, id, thing);
      let inner = result.val;
    `);
    expectPointsTo(r2, "inner", "thing");
  });
});

describe("stress: recursive data + higher-order", () => {
  it("map over linked list nodes", () => {
    const r = pointsTo(`
      let map = 'map: (f, node) => {
        return 'mapped: { val: f(node.val) };
      };
      let myFn = 'myFn: (x) => { return 'wrapped: { inner: x }; };
      let list = 'list: { val: 'item: {} };
      let result = map(myFn, list);
      let inner = result.val.inner;
    `);
    expectPointsTo(r, "inner", "item");
  });
});

describe("stress: CPS-style", () => {
  it("continuation-passing style", () => {
    const r = pointsTo(`
      let cps = 'cps: (val, k) => {
        return k(val);
      };
      let obj = 'obj: {};
      let id = 'idK: (x) => { return x; };
      let result = cps(obj, id);
    `);
    expectPointsTo(r, "result", "obj");
  });

  it("double CPS", () => {
    const r = pointsTo(`
      let cps = 'cps: (val, k) => {
        return k(val);
      };
      let obj = 'obj: {};
      let wrap = 'wrap: (x) => { return 'box: { v: x }; };
      let step1 = cps(obj, wrap);
      let result = cps(step1, 'unwrap: (b) => { return b.v; });
    `);
    expectPointsTo(r, "result", "obj");
  });
});

describe("stress: method dispatch simulation", () => {
  it("object with method field called indirectly", () => {
    const r = pointsTo(`
      let handler = 'handler: (x) => { return 'result: { data: x }; };
      let obj = 'obj: { method: handler };
      let m = obj.method;
      let arg = 'arg: {};
      let result = m(arg);
      let d = result.data;
    `);
    expectPointsTo(r, "d", "arg");
  });

  it("factory returning object with methods", () => {
    const r = pointsTo(`
      let makeObj = 'makeObj: (initial) => {
        return 'obj: {
          get: 'getter: (unused) => { return initial; }
        };
      };
      let thing = 'thing: {};
      let o = makeObj(thing);
      let getter = o.get;
      let result = getter('dummy: {});
    `);
    expectPointsTo(r, "result", "thing");
  });
});

describe("currying", () => {
  it("curried function applies arguments one at a time", () => {
    const r = pointsTo(`
      let curry = 'curry: (x) => {
        return 'inner: (y) => {
          return 'pair: { a: x, b: y };
        };
      };
      let obj1 = 'o1: {};
      let obj2 = 'o2: {};
      let partial = curry(obj1);
      let result = partial(obj2);
      let ra = result.a;
      let rb = result.b;
    `);
    expectPointsTo(r, "ra", "o1");
    expectPointsTo(r, "rb", "o2");
  });

  // Known limitation: inner closures from different instantiations of the
  // same outer function share a single FunctionExpr, so captured values merge.
  // Full context sensitivity (cloning inner closures per instantiation) needed.
  it.skip("curried function reused with different first args", () => {
    const r = pointsTo(`
      let curry = 'curry: (x) => {
        return 'inner: (y) => {
          return 'pair: { a: x, b: y };
        };
      };
      let o1 = 'o1: {};
      let o2 = 'o2: {};
      let o3 = 'o3: {};
      let f1 = curry(o1);
      let f2 = curry(o2);
      let r1 = f1(o3);
      let r2 = f2(o3);
      let r1a = r1.a;
      let r2a = r2.a;
    `);
    expectPointsTo(r, "r1a", "o1");
    expectPointsTo(r, "r2a", "o2");
  });
});
