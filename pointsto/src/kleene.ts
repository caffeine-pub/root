import type { FunctionExpr } from "./ast.js";
import type { GraphNode, Instantiation } from "./callgraph.js";
import {
  type PlaceId,
  type AbstractObjectId,
  type Owner,
  places,
  objects,
  objectField,
  cloneObject,
} from "./arenas.js";

export { type PlaceId, type AbstractObjectId, type Owner } from "./arenas.js";
export { places, objects, objectField } from "./arenas.js";

function addAllTo<T>(from: Set<T>, to: Set<T>) {
  const before = to.size;
  for (const obj of from) to.add(obj);
  return to.size !== before;
}

export class PossibleValues {
  constructor(
    public objects: Set<AbstractObjectId> = new Set(),
    public functions: Set<FunctionExpr | Instantiation> = new Set(),
  ) {}

  field(index: string): Set<PlaceId> {
    return new Set([...this.objects].map((id) => objectField(id, index)));
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

export class Constraint {}

export class SubsetConstraint extends Constraint {
  // foo = bar;
  // pts(lhs) ⊇ pts(rhs): rhs flows into lhs
  constructor(
    public lhs: PlaceId,
    public rhs: PlaceId | PossibleValues,
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
    public lhs: PlaceId,
    public base: PlaceId,
    public field: string,
  ) {
    super();
  }
}

export class FieldStoreConstraint extends Constraint {
  // foo.bar = baz;
  // for each obj in pts(base), pts(obj.field) ⊇ pts(rhs)
  constructor(
    public base: PlaceId,
    public field: string,
    public rhs: PlaceId | PossibleValues,
  ) {
    super();
  }
}

export class CallConstraint extends Constraint {
  // result = callee(...args)
  // when callee resolves to functions, wire args → params and return → result
  constructor(
    public result: PlaceId,
    public callee: PlaceId,
    public args: (PlaceId | PossibleValues | null)[],
    public caller: GraphNode,
  ) {
    super();
  }
}

interface InstantiateResult {
  rewrite: Map<PlaceId, PlaceId>;
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

  const rewrite = new Map<PlaceId, PlaceId>();
  function lookup(p: PlaceId): PlaceId {
    const place = places.get(p);
    if (!isOwnedByTarget(place.owner)) return p; // captured from outer scope
    const exists = rewrite.get(p);
    if (exists !== undefined) return exists;

    const result = places.alloc(`${place.name}_instant`, place.owner);
    rewrite.set(p, result);
    return result;
  }

  function renewPossibleValues(pv: PossibleValues): PossibleValues {
    const newObjects = new Set<AbstractObjectId>();
    for (const objId of pv.objects) {
      const obj = objects.get(objId);
      if (!isOwnedByTarget(obj.owner)) {
        newObjects.add(objId);
      } else {
        newObjects.add(cloneObject(objId, lookup, obj.owner));
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
          typeof constraint.rhs === "number"
            ? lookup(constraint.rhs)
            : renewPossibleValues(constraint.rhs),
        ),
      );
    } else if (constraint instanceof FieldStoreConstraint) {
      newConstraints.push(
        new FieldStoreConstraint(
          lookup(constraint.base),
          constraint.field,
          typeof constraint.rhs === "number"
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
            typeof a === "number"
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
  state: Map<PlaceId, PossibleValues>;
  constraints: Constraint[];
  instantiate: (
    owner: Owner,
    nesting: Map<Owner, Owner | null>,
  ) => InstantiateResult;
}

// assuming trivial subset transfer function
export function solve(
  constraints: Constraint[],
  state: Map<PlaceId, PossibleValues> = new Map(),
): SolverResult {
  const nextIterations = new Map<PlaceId, Constraint[]>();
  function addConstraintToNextIterations(rhs: PlaceId, constraint: Constraint) {
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
      typeof constraint.rhs === "number"
    ) {
      addConstraintToNextIterations(constraint.rhs, constraint);
    } else if (constraint instanceof FieldLoadConstraint) {
      addConstraintToNextIterations(constraint.base, constraint);
    } else if (constraint instanceof FieldStoreConstraint) {
      addConstraintToNextIterations(constraint.base, constraint);
      if (typeof constraint.rhs === "number") {
        addConstraintToNextIterations(constraint.rhs, constraint);
      }
    } else if (constraint instanceof CallConstraint) {
      addConstraintToNextIterations(constraint.callee, constraint);
    }
  }

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
        const base = state.get(constraint.base);
        if (!base) continue;
        const baseIndexed = base.field(constraint.field);
        for (const placeId of baseIndexed) {
          addConstraintToNextIterations(placeId, constraint);
          doSubsetFlow(constraint.lhs, placeId);
        }
      } else if (constraint instanceof FieldStoreConstraint) {
        const base = state.get(constraint.base);
        if (!base) continue;
        const baseIndexed = base.field(constraint.field);
        for (const placeId of baseIndexed) {
          doSubsetFlow(placeId, constraint.rhs);
        }
      } else if (constraint instanceof CallConstraint) {
        // the solver just propagates values through the callee Place.
        // actual function wiring is handled by Iteration in analysis.ts.
      }
    }

    function doSubsetFlow(lhs: PlaceId, rhs: PlaceId | PossibleValues) {
      let dirty;

      if (!state.has(lhs)) {
        state.set(lhs, new PossibleValues());
      }

      const stateLhs = state.get(lhs)!;

      if (typeof rhs === "number") {
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

  function addAll(placeId: PlaceId) {
    const exists = nextIterations.get(placeId);
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
  const holes = new Set<PlaceId>(nextIterations.keys());
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
      const stateConstraints: Constraint[] = [];
      for (const [placeId, values] of state) {
        stateConstraints.push(new SubsetConstraint(placeId, values));
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
