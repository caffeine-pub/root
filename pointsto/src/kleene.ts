import { FunctionExpr } from "./ast.js";

function addAllTo<T>(from: Set<T>, to: Set<T>) {
  const before = to.size;
  for (const obj of from) to.add(obj);
  return to.size !== before;
}

export class PossibleValues {
  constructor(
    public objects: Set<AbstractObject> = new Set(),
    public functions: Set<FunctionExpr> = new Set(),
  ) {}

  field(index: string): Set<Place> {
    return new Set([...this.objects].map((o) => o.field(index)));
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
    public level: number,
  ) {}

  field(index: string): Place {
    this.cache ??= new Map();
    const exists = this.cache.get(index);
    if (exists) return exists;
    const result = new Place(`${this.name}.${index}`, this.level);
    this.cache.set(index, result);
    return result;
  }

  clone(lookup: (p: Place) => Place) {
    const newObject = new AbstractObject(`${this.name}_instant`, this.level);

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
    public level: number,
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
  instantiateAtLevel: number,
): InstantiateResult {
  const rewrite = new WeakMap<Place, Place>();
  function lookup(p: Place) {
    if (p.level < instantiateAtLevel) return p; // this place is captured and is defined in a higher function
    const exists = rewrite.get(p);
    if (exists) return exists;

    const result = new Place(`${p.name}_instant`, p.level);
    rewrite.set(p, result);
    return result;
  }

  function renewPossibleValues(pv: PossibleValues): PossibleValues {
    const newObjects = new Set<AbstractObject>();
    for (const obj of pv.objects) {
      if (obj.level < instantiateAtLevel) {
        newObjects.add(obj);
      } else {
        newObjects.add(obj.clone(lookup));
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
        ),
      );
    }
  }

  return { rewrite, newConstraints };
}

export interface SolverResult {
  state: Map<Place, PossibleValues>;
  constraints: Constraint[];
  instantiate: (atLevel: number) => InstantiateResult;
}

export interface CallResolutionContext {
  /** function node → param places, return place, level */
  functions: Map<any, { params: Place[]; returnVar: Place; level: number }>;
  /** function node → its solved result (for cross-SCC instantiation) */
  solutions: Map<any, SolverResult>;
  /** functions in the current SCC (same-SCC calls wire directly, no instantiation) */
  currentScc: Set<any>;
}

// assuming trivial subset transfer function
export function solve(
  constraints: Constraint[],
  state: Map<Place, PossibleValues> = new Map(),
  callCtx?: CallResolutionContext,
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

  // track how many times each callee solution has been instantiated
  // to prevent unbounded instantiation chains (e.g. mutual recursion)
  // keyed on the SolverResult object — functions in the same SCC share one
  const instantiationCount = new Map<SolverResult, number>();
  // track which (CallConstraint instance, callee function) pairs we've wired
  // use a Map<CallConstraint, Set<FunctionExpr>> for object-identity dedup
  const wiredCalls = new Map<CallConstraint, Set<FunctionExpr>>();

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
      } else if (constraint instanceof CallConstraint && callCtx) {
        // result = callee(...args)
        // check what the callee Place points to — first in local state,
        // then in all solutions (callee may be a captured variable from
        // a parent scope that was solved in a different SCC)
        let calleeValues = state.get(constraint.callee);
        if (!calleeValues) {
          for (const solution of callCtx.solutions.values()) {
            const sv = solution.state.get(constraint.callee);
            if (sv && sv.functions.size > 0) {
              calleeValues = sv;
              break;
            }
          }
        }
        if (!calleeValues) continue;

        for (const calleeFn of calleeValues.functions) {
          // deduplicate: don't wire the same (constraint instance, callee) pair twice
          // use object identity, not string names
          let wiredSet = wiredCalls.get(constraint);
          if (!wiredSet) {
            wiredSet = new Set();
            wiredCalls.set(constraint, wiredSet);
          }
          if (wiredSet.has(calleeFn)) continue;
          wiredSet.add(calleeFn);

          const fnInfo = callCtx.functions.get(calleeFn);
          if (!fnInfo) continue;

          if (callCtx.currentScc.has(calleeFn)) {
            // same SCC: wire directly to original params/return
            const paramCount = Math.min(constraint.args.length, fnInfo.params.length);
            for (let i = 0; i < paramCount; i++) {
              const arg = constraint.args[i];
              if (arg) {
                const newConstraint = new SubsetConstraint(fnInfo.params[i], arg);
                constraints.push(newConstraint);
                if (arg instanceof Place) {
                  addConstraintToNextIterations(arg, newConstraint);
                }
                nextTransitionsForThisIteration.add(newConstraint);
              }
            }
            const retConstraint = new SubsetConstraint(constraint.result, fnInfo.returnVar);
            constraints.push(retConstraint);
            addConstraintToNextIterations(fnInfo.returnVar, retConstraint);
            nextTransitionsForThisIteration.add(retConstraint);
          } else {
            // cross-SCC: instantiate callee's solution
            const calleeSolution = callCtx.solutions.get(calleeFn);
            if (!calleeSolution) continue;
            const count = instantiationCount.get(calleeSolution) ?? 0;
            if (count >= 2) continue; // prevent unbounded instantiation chains
            instantiationCount.set(calleeSolution, count + 1);

            const inst = calleeSolution.instantiate(fnInfo.level);

            // wire args → instantiated params
            const paramCount2 = Math.min(constraint.args.length, fnInfo.params.length);
            for (let i = 0; i < paramCount2; i++) {
              const arg = constraint.args[i];
              const param = inst.rewrite.get(fnInfo.params[i]) ?? fnInfo.params[i];
              if (arg) {
                const newConstraint = new SubsetConstraint(param, arg);
                constraints.push(newConstraint);
                if (arg instanceof Place) {
                  addConstraintToNextIterations(arg, newConstraint);
                }
                nextTransitionsForThisIteration.add(newConstraint);
              }
            }

            // include callee's body constraints
            for (const c of inst.newConstraints) {
              constraints.push(c);
              nextTransitionsForThisIteration.add(c);
              // register for future iterations
              if (c instanceof SubsetConstraint && c.rhs instanceof Place) {
                addConstraintToNextIterations(c.rhs, c);
              } else if (c instanceof FieldLoadConstraint) {
                addConstraintToNextIterations(c.base, c);
              } else if (c instanceof FieldStoreConstraint) {
                addConstraintToNextIterations(c.base, c);
                if (c.rhs instanceof Place) {
                  addConstraintToNextIterations(c.rhs, c);
                }
              } else if (c instanceof CallConstraint) {
                addConstraintToNextIterations(c.callee, c);
              }
            }

            // wire instantiated return → result
            const returnVar = inst.rewrite.get(fnInfo.returnVar) ?? fnInfo.returnVar;
            const retConstraint = new SubsetConstraint(constraint.result, returnVar);
            constraints.push(retConstraint);
            addConstraintToNextIterations(returnVar, retConstraint);
            nextTransitionsForThisIteration.add(retConstraint);
          }
        }
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
    instantiate: (atLevel: number) => {
      // include state entries as SubsetConstraints so PossibleValues
      // get their AbstractObjects cloned through renewPossibleValues too
      const stateConstraints: Constraint[] = [];
      for (const [place, values] of state) {
        stateConstraints.push(new SubsetConstraint(place, values));
      }
      const inst = instantiate(
        [...remainingEquations, ...stateConstraints],
        atLevel,
      );
      return inst;
    },
  };
}
