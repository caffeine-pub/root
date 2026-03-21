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

// assuming trivial subset transfer function
export function solve<T>(
  constraints: SubsetConstraint<T>[],
  hash: (value: T) => string,
) {
  const state = new WeakMap<Variable, HashSet<T>>();

  let dirty = false;
  for (let i = 1; i < 5000; i++) {
    dirty = false;

    for (const constraint of constraints) {
      if (constraint.rhs instanceof Variable && !state.has(constraint.rhs)) {
        continue;
      }

      if (!state.has(constraint.lhs)) {
        state.set(constraint.lhs, new HashSet(hash));
      }

      const stateLhs = state.get(constraint.lhs)!;
      if (constraint.rhs instanceof Variable) {
        dirty = stateLhs.addAll(state.get(constraint.rhs)!) || dirty;
      } else if (constraint.rhs instanceof HashSet) {
        dirty = stateLhs.addAll(constraint.rhs) || dirty;
      }
    }

    if (!dirty) break;
  }

  if (dirty) {
    console.warn("kleene did not converge in 5000 steps");
  }

  return state;
}
