# Call Instantiation — Design Notes

## The Problem

The `case "call"` in analysis.ts has a TODO:

```ts
case "call": {
  const place = this.placeMap.exprResolution.get(expr)! as Place;
  const callee = this.expr(expr.callee);
  // TODO: instantiate and process returns if previous solution found
  return place;
}
```

When we see `let x = f(a, b)`, we need to:
1. Figure out which functions `f` can be (from `calleeResolution` or solver state)
2. For each target function, clone its body's constraints with fresh local places
3. Wire up: args flow into cloned params, cloned return flows into the call result place
4. Add the cloned constraints to this iteration's constraint set

## What We Have

- `placeMap.functions.get(fnExpr)` → `{ params: Place[], returnVar: Place, level: number }`
- `placeMap.calleeResolution.get(fn)` → `Set<Place | FunctionExpr>` (which functions a given function node calls)
- `solve()` returns `{ state, instantiate: (atLevel) => InstantiateResult }`
- `InstantiateResult` = `{ rewrite: WeakMap<Place, Place>, newConstraints: Constraint[] }`

## The Key Issue: Per-Function Constraints

`instantiate()` currently operates on `remainingEquations` — the constraints reachable from "holes" (places that were on RHS of a dependency but never got concrete PossibleValues). This is a global set from the entire solve.

But for call instantiation, we need **per-function** constraints. When we call function F, we want to instantiate F's constraints specifically, not all remaining equations globally.

### Option A: Store constraints per function during Iteration.run()

During `Iteration.run()`, track which constraints were generated while walking each function body:

```ts
private perFunctionConstraints = new Map<FunctionNode, Constraint[]>();
```

When processing a call in a later iteration, pull from this map:

```ts
case "call": {
  const place = this.placeMap.exprResolution.get(expr)! as Place;
  // ... resolve callees from solution ...
  for (const targetFn of resolvedCallees) {
    const fnInfo = this.placeMap.functions.get(targetFn)!;
    const fnConstraints = this.perFunctionConstraints.get(targetFn);
    if (!fnConstraints) continue;
    
    const { rewrite, newConstraints } = instantiate(fnConstraints, fnInfo.level);
    
    // wire args → params
    for (let i = 0; i < expr.args.length; i++) {
      const arg = this.expr(expr.args[i]);
      const param = rewrite.get(fnInfo.params[i]) ?? fnInfo.params[i];
      if (arg && param) this.constraints.push(new SubsetConstraint(param, arg));
    }
    
    // wire return → call result
    const ret = rewrite.get(fnInfo.returnVar) ?? fnInfo.returnVar;
    this.constraints.push(new SubsetConstraint(place, ret));
    
    // add cloned constraints
    this.constraints.push(...newConstraints);
  }
  return place;
}
```

### Option B: Re-walk the function body per call site

Instead of storing constraints, just re-run `this.walkFunctionBody(targetFn)` inside a scope where the constraints get collected separately, then instantiate those.

Simpler conceptually but means re-walking the AST for every call site.

### Option C: Solve per-function, keep SolverResults

```ts
private perFunctionSolverResult = new Map<FunctionNode, SolverResult>();
```

Each function gets solved independently, and its `instantiate()` method captures its own remaining equations. Then at call sites, call `solverResult.instantiate(level)`.

Problem: functions in the same SCC are solved together. You'd need to split constraints by function after collecting them.

## Recommendation

**Option A** is simplest and fits the current architecture. The Iteration already walks function bodies — just tag constraints with which function they came from. The `instantiate()` function in kleene.ts already handles level-based cloning correctly.

The flow becomes:

1. First iteration: walk all functions, collect per-function constraints, solve globally
2. Outer loop detects new call graph edges
3. Next iteration: when processing a call, look up target's constraints, instantiate at target's level, wire args/return, add to constraint set, solve again

## SCC Subtlety

Options A and C have a wrinkle with SCCs. If F and G are mutually recursive (same SCC), their constraints are walked together. When an external caller calls F, instantiating "F's constraints" isn't clean — F's body might call G, generating constraints that reference G's places. You'd need to instantiate G's constraints too, which means you're instantiating the whole SCC's constraints.

This is probably fine: just store constraints per-SCC and instantiate the batch. The level check still handles which places get cloned correctly. The caller only connects to F's params/return — G's internal wiring comes along for free via the cloned constraints.

## Cross-Iteration Storage

Per-function (or per-SCC) constraints need to persist across iterations, not just within a single `Iteration.run()`. The outer `analyze()` loop needs something like:

```ts
const perFunctionConstraints = new Map<FunctionNode, Constraint[]>();
```

Passed into each Iteration so it can:
1. Record constraints during walking (write)
2. Look up callee constraints during call processing (read)

This means constraint storage lives at the `analyze()` level, not the `Iteration` level.

## Level Semantics Reminder

- `instantiate(constraints, level)` clones places where `place.level >= level`
- Captured variables (level < function's level) pass through unchanged  
- This is exactly Rémy's levels from HM type inference
- Nested functions: if F (level 1) contains G (level 2), instantiating F clones level 1+ places, which includes G's locals (level 2). If you then instantiate G separately within the cloned F, it clones level 2+ places using the already-cloned level 1 context.
