import { HashSet } from "ts-hash";

export class Variable {
  constructor(public name: string) {}
}

export class SubsetConstraint<T> {
  // lhs ⊇ rhs: rhs flows into lhs
  constructor(
    public lhs: Variable,
    public rhs: Variable | HashSet<T>,
  ) {}
}

interface InstantiateResult<T> {
  rewrite: WeakMap<Variable, Variable>;
  newConstraints: SubsetConstraint<T>[];
}

function instantiate<T>(
  constraints: SubsetConstraint<T>[],
): InstantiateResult<T> {
  const rewrite = new WeakMap<Variable, Variable>();
  function lookup(v: Variable) {
    const exists = rewrite.get(v);
    if (exists) return exists;

    const result = new Variable(`${v.name}_instant`);
    rewrite.set(v, result);
    return result;
  }

  const newConstraints = [];
  for (const constraint of constraints) {
    newConstraints.push(
      new SubsetConstraint(
        lookup(constraint.lhs),
        constraint.rhs instanceof Variable
          ? lookup(constraint.rhs)
          : constraint.rhs,
      ),
    );
  }

  return { rewrite, newConstraints };
}

interface SolverResult<T> {
  state: WeakMap<Variable, HashSet<T>>;
  instantiate?: () => InstantiateResult<T>;
}

// assuming trivial subset transfer function
export function solve<T>(
  constraints: SubsetConstraint<T>[],
  hash: (value: T) => string,
  state: WeakMap<Variable, HashSet<T>> = new WeakMap(),
): SolverResult<T> {
  const toFlowInto = new Map<Variable, SubsetConstraint<T>[]>();

  for (const constraint of constraints) {
    if (constraint.rhs instanceof Variable) {
      const exists = toFlowInto.get(constraint.rhs);
      if (exists) {
        exists.push(constraint);
      } else {
        toFlowInto.set(constraint.rhs, [constraint]);
      }
    }
  }

  const holes = new Set<Variable>(toFlowInto.keys());

  for (const constraint of constraints) {
    if (constraint.rhs instanceof HashSet) {
      holes.delete(constraint.lhs);
    }
  }

  const nextTransitions = new Set<SubsetConstraint<T>>(constraints);

  for (let i = 1; i < 5000; i++) {
    const theseTransitions = [...nextTransitions];
    nextTransitions.clear();

    for (const constraint of theseTransitions) {
      if (constraint.rhs instanceof Variable && !state.has(constraint.rhs)) {
        continue;
      }

      if (!state.has(constraint.lhs)) {
        state.set(constraint.lhs, new HashSet(hash));
      }

      const stateLhs = state.get(constraint.lhs)!;
      let dirty;
      if (constraint.rhs instanceof Variable) {
        dirty = stateLhs.addAll(state.get(constraint.rhs)!);
      } else if (constraint.rhs instanceof HashSet) {
        dirty = stateLhs.addAll(constraint.rhs);
      }

      if (dirty) {
        const transitions = toFlowInto.get(constraint.lhs);
        if (transitions)
          for (const transition of transitions) nextTransitions.add(transition);
      }
    }

    if (nextTransitions.size === 0) break;
  }

  if (nextTransitions.size > 0) {
    console.warn("kleene did not converge in 5000 steps");
  }

  if (holes.size === 0) {
    return {
      state,
    };
  }

  const remainingEquations = new Set<SubsetConstraint<T>>();

  function addAll(variable: Variable) {
    const exists = toFlowInto.get(variable);
    if (exists) {
      for (const constraint of exists) {
        if (remainingEquations.has(constraint)) continue;
        remainingEquations.add(constraint);
        addAll(constraint.lhs);
      }
    }
  }

  for (const hole of holes) {
    addAll(hole);
  }

  return {
    state,
    instantiate: () => instantiate([...remainingEquations]),
  };
}
