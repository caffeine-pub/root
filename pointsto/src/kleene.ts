import type { FunctionExpr, Program } from "./ast.js";
import type { GraphNode, Instantiation } from "./callgraph.js";

export type Owner = FunctionExpr | Program;

/** Check if `inner` is the same as or lexically nested inside `outer` */
export function isOwnedBy(inner: Owner, outer: Owner): boolean {
  // Program owns everything
  if (inner === outer) return true;
  return false; // conservative — caller must walk the nesting chain
}

function addAllTo<T>(from: Set<T>, to: Set<T>) {
  const before = to.size;
  for (const obj of from) to.add(obj);
  return to.size !== before;
}

export class PossibleValues {
  constructor(
    public objects: Set<AbstractObject> = new Set(),
    public functions: Set<FunctionExpr | Instantiation> = new Set(), // this has to be a linear set?
  ) {}

  field(index: string): Set<Place> {
    return new Set([...this.objects].map((o) => o.field(index)));
  }

  eq(other: PossibleValues): boolean {
    if (this.objects.size !== other.objects.size) return false;
    if (this.functions.size !== other.functions.size) return false;
    for (const obj of this.objects) {
      if (!other.objects.has(obj)) return false;
    }
    for (const fn of this.functions) {
      if (!other.functions.has(fn)) return false;
    }
    return true;
  }

  addAll(other: PossibleValues) {
    const objectsDirty = addAllTo(other.objects, this.objects);
    const functionsDirty = addAllTo(other.functions, this.functions);
    return objectsDirty || functionsDirty;
  }
}

export class AbstractObject {
  private cache?: Map<string, Place>;
  constructor(
    public name: string,
    public owner: Owner,
  ) {}

  field(index: string): Place {
    this.cache ??= new Map();
    const exists = this.cache.get(index);
    if (exists) return exists;
    const result = new Place(`${this.name}.${index}`, this.owner);
    this.cache.set(index, result);
    return result;
  }

  clone(lookup: (p: Place) => Place, newOwner: Owner) {
    const newObject = new AbstractObject(`${this.name}_instant`, newOwner);

    if (this.cache) {
      const newCache = new Map<string, Place>();
      newObject.cache = newCache;

      for (const [name, place] of this.cache?.entries()) {
        newCache.set(name, lookup(place));
      }
    }

    return newObject;
  }
}

export class Place {
  constructor(
    public name: string,
    public owner: Owner,
  ) {}
}

export class Constraint {}

export class SubsetConstraint extends Constraint {
  // foo = bar;
  // pts(lhs) ⊇ pts(rhs): rhs flows into lhs
  constructor(
    public lhs: Place,
    public rhs: Place | PossibleValues,
  ) {
    super();
  }
}

// for these, remember:
//
// place.field("foo")
//
// IS NOT EQUAL TO
//
// pts(place).field("foo")

export class FieldLoadConstraint extends Constraint {
  // baz = foo.bar;
  // for each obj in pts(base), pts(lhs) ⊇ pts(obj.field)

  constructor(
    public lhs: Place,
    public base: Place,
    public field: string,
  ) {
    super();
  }
}

export class FieldStoreConstraint extends Constraint {
  // foo.bar = baz;
  // for each obj in pts(base), pts(obj.field) ⊇ pts(rhs)
  constructor(
    public base: Place,
    public field: string,
    public rhs: Place | PossibleValues,
  ) {
    super();
  }
}

export class CallConstraint extends Constraint {
  // result = callee(...args)
  // when callee resolves to functions, wire args → params and return → result
  constructor(
    public result: Place,
    public callee: Place,
    public args: (Place | PossibleValues | null)[],
    public caller: GraphNode,
  ) {
    super();
  }
}

interface InstantiateResult {
  rewrite: WeakMap<Place, Place>;
  newConstraints: Constraint[];
}

function instantiate(
  constraints: Constraint[],
  owner: Owner,
  nesting: Map<Owner, Owner | null>,
): InstantiateResult {
  function isOwnedByTarget(o: Owner): boolean {
    let cur: Owner | null | undefined = o;
    while (cur != null) {
      if (cur === owner) return true;
      cur = nesting.get(cur);
    }
    return false;
  }

  const rewrite = new WeakMap<Place, Place>();
  function lookup(p: Place) {
    if (!isOwnedByTarget(p.owner)) return p; // captured from outer scope
    const exists = rewrite.get(p);
    if (exists) return exists;

    const result = new Place(`${p.name}_instant`, p.owner);
    rewrite.set(p, result);
    return result;
  }

  function renewPossibleValues(pv: PossibleValues): PossibleValues {
    const newObjects = new Set<AbstractObject>();
    for (const obj of pv.objects) {
      if (!isOwnedByTarget(obj.owner)) {
        newObjects.add(obj);
      } else {
        newObjects.add(obj.clone(lookup, obj.owner));
      }
    }
    return new PossibleValues(newObjects, new Set(pv.functions));
  }

  const newConstraints: Constraint[] = [];
  for (const constraint of constraints) {
    if (constraint instanceof SubsetConstraint) {
      newConstraints.push(
        new SubsetConstraint(
          lookup(constraint.lhs),
          constraint.rhs instanceof Place
            ? lookup(constraint.rhs)
            : renewPossibleValues(constraint.rhs),
        ),
      );
    } else if (constraint instanceof FieldStoreConstraint) {
      newConstraints.push(
        new FieldStoreConstraint(
          lookup(constraint.base),
          constraint.field,
          constraint.rhs instanceof Place
            ? lookup(constraint.rhs)
            : renewPossibleValues(constraint.rhs),
        ),
      );
    } else if (constraint instanceof FieldLoadConstraint) {
      newConstraints.push(
        new FieldLoadConstraint(
          lookup(constraint.lhs),
          lookup(constraint.base),
          constraint.field,
        ),
      );
    } else if (constraint instanceof CallConstraint) {
      newConstraints.push(
        new CallConstraint(
          lookup(constraint.result),
          lookup(constraint.callee),
          constraint.args.map((a) =>
            a instanceof Place
              ? lookup(a)
              : a instanceof PossibleValues
                ? renewPossibleValues(a)
                : null,
          ),
          constraint.caller,
        ),
      );
    }
  }

  return { rewrite, newConstraints };
}

export interface SolverResult {
  state: Map<Place, PossibleValues>;
  constraints: Constraint[];
  instantiate: (
    owner: Owner,
    nesting: Map<Owner, Owner | null>,
  ) => InstantiateResult;
}

// assuming trivial subset transfer function
export function solve(
  constraints: Constraint[],
  state: Map<Place, PossibleValues> = new Map(),
): SolverResult {
  const nextIterations = new Map<Place, Constraint[]>();
  function addConstraintToNextIterations(rhs: Place, constraint: Constraint) {
    const exists = nextIterations.get(rhs);
    if (exists) {
      exists.push(constraint);
    } else {
      nextIterations.set(rhs, [constraint]);
    }
  }

  for (const constraint of constraints) {
    if (
      constraint instanceof SubsetConstraint &&
      constraint.rhs instanceof Place
    ) {
      // foo = bar;
      // if bar updates, we want it to flow into foo
      addConstraintToNextIterations(constraint.rhs, constraint);
    } else if (constraint instanceof FieldLoadConstraint) {
      // baz = foo.bar;
      // if foo has new points-to, we want it to propagate into baz
      addConstraintToNextIterations(constraint.base, constraint);
    } else if (constraint instanceof FieldStoreConstraint) {
      // imagine we have
      // foo.bar = baz;
      // if foo has new points-to, we want to propagate the .bar = baz to those
      addConstraintToNextIterations(constraint.base, constraint);

      // likewise, if baz updates, we want to propagate that to foo.bar
      if (constraint.rhs instanceof Place) {
        addConstraintToNextIterations(constraint.rhs, constraint);
      }
    } else if (constraint instanceof CallConstraint) {
      // result = callee(...args)
      // if callee updates, we want to wire params/return
      addConstraintToNextIterations(constraint.callee, constraint);
    }
  }

  // const holes = new Set<Variable>(nextIterations.keys());

  // for (const constraint of constraints) {
  //   if (constraint.rhs instanceof Set) {
  //     holes.delete(constraint.lhs);
  //   }
  // }

  const nextTransitionsForThisIteration = new Set<Constraint>(constraints);

  for (let i = 1; i < 5000; i++) {
    const theseTransitionsForThisIteration = [
      ...nextTransitionsForThisIteration,
    ];
    nextTransitionsForThisIteration.clear();

    for (const constraint of theseTransitionsForThisIteration) {
      if (constraint instanceof SubsetConstraint) {
        doSubsetFlow(constraint.lhs, constraint.rhs);
      } else if (constraint instanceof FieldLoadConstraint) {
        // get points-to set for foo first, before getting .bar
        // then those .bar places flow into lhs
        const base = state.get(constraint.base);
        if (!base) continue;
        const baseIndexed = base.field(constraint.field);
        for (const place of baseIndexed) {
          // since place appears on rhs, we need to register it in case it's not already
          addConstraintToNextIterations(place, constraint);
          doSubsetFlow(constraint.lhs, place);
        }
      } else if (constraint instanceof FieldStoreConstraint) {
        // get points-to set for foo first, before getting .bar,
        // then rhs flows into those .bar places
        const base = state.get(constraint.base);
        if (!base) continue;
        const baseIndexed = base.field(constraint.field);
        for (const place of baseIndexed) {
          doSubsetFlow(place, constraint.rhs);
        }
      } else if (constraint instanceof CallConstraint) {
        // the solver just propagates values through the callee Place.
        // actual function wiring (args → params, return → result) is
        // handled by Iteration in analysis.ts using solved state from
        // previous outer-loop iterations.
        // nothing to do here — the callee Place is already registered
        // in nextIterations so when it gets new values, we'll re-visit
        // this constraint (which lets the outer loop discover new callees).
      }
    }

    function doSubsetFlow(lhs: Place, rhs: Place | PossibleValues) {
      let dirty;

      if (!state.has(lhs)) {
        state.set(lhs, new PossibleValues());
      }

      const stateLhs = state.get(lhs)!;

      if (rhs instanceof Place) {
        const stateRhs = state.get(rhs);
        if (!stateRhs) return;
        dirty = stateLhs.addAll(stateRhs);
      } else if (rhs instanceof PossibleValues) {
        dirty = stateLhs.addAll(rhs);
      }

      if (dirty) {
        const transitions = nextIterations.get(lhs);
        if (transitions)
          for (const transition of transitions)
            nextTransitionsForThisIteration.add(transition);
      }
    }

    if (nextTransitionsForThisIteration.size === 0) break;
  }

  if (nextTransitionsForThisIteration.size > 0) {
    console.warn("kleene did not converge in 5000 steps");
  }

  const remainingEquations = new Set<Constraint>();

  function addAll(place: Place) {
    const exists = nextIterations.get(place);
    if (exists) {
      for (const constraint of exists) {
        if (remainingEquations.has(constraint)) continue;
        remainingEquations.add(constraint);
        if (constraint instanceof SubsetConstraint) {
          addAll(constraint.lhs);
        } else if (constraint instanceof FieldLoadConstraint) {
          addAll(constraint.lhs);
        } else if (constraint instanceof FieldStoreConstraint) {
          addAll(constraint.base);
        }
      }
    }
  }

  // holes: places that appear on rhs but never got a concrete value
  const holes = new Set<Place>(nextIterations.keys());
  for (const constraint of constraints) {
    if (
      constraint instanceof SubsetConstraint &&
      constraint.rhs instanceof PossibleValues
    ) {
      holes.delete(constraint.lhs);
    }
  }

  for (const hole of holes) {
    addAll(hole);
  }

  return {
    state,
    constraints,
    instantiate: (owner: Owner, nesting: Map<Owner, Owner | null>) => {
      // include state entries as SubsetConstraints so PossibleValues
      // get their AbstractObjects cloned through renewPossibleValues too
      const stateConstraints: Constraint[] = [];
      for (const [place, values] of state) {
        stateConstraints.push(new SubsetConstraint(place, values));
      }
      const inst = instantiate(
        [...remainingEquations, ...stateConstraints],
        owner,
        nesting,
      );
      return inst;
    },
  };
}
