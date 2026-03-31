import type {
  Expr,
  FunctionExpr,
  IdentExpr,
  MemberExpr,
  Program,
  Stmt,
} from "./ast.js";
import { CallGraph, GraphNode, Instantiation } from "./callgraph.js";
import {
  type PlaceId,
  places,
  objects,
  objectField,
  CallConstraint,
  Constraint,
  FieldLoadConstraint,
  FieldStoreConstraint,
  PossibleValues,
  solve,
  SolverResult,
  SubsetConstraint,
  instantiate as instantiateConstraints,
} from "./kleene.js";
import { buildPlaces, PlaceMap } from "./places.js";

const assert = <T>(arg: T | undefined | null): T => {
  if (arg == null) throw new Error("assertion failed");
  return arg;
};

const debug = (...args: any[]) => {
  if (process.env.DEBUG) console.log(...args);
};

const todo = (): never => {
  throw new Error("todo");
};

export function analyze(program: Program): Map<PlaceId, PossibleValues> {
  // run IR
  const placeMap = buildPlaces(program);

  const callgraph = new CallGraph();
  let solutions: Map<GraphNode, SolverResult> = new Map();
  /** Shared across iterations: per-FunctionExpr body constraints */
  const fnConstraintCache = new Map<FunctionExpr, Constraint[]>();

  let sccs: GraphNode[][] = [[program]];
  for (let i = 0; i < 5000; i++) {
    debug("\niteration", i);
    callgraph.clearDirty();

    // phase 1: collect constraints from all SCCs, then solve together
    const callConstraints: CallConstraint[] = [];
    const allConstraints: Constraint[] = [];
    const allNodes: GraphNode[] = [];
    for (const scc of sccs) {
      debug(
        "\nprocessing SCC:",
        scc.map((n) => n.hash),
      );

      const iteration = new Iteration(
        placeMap,
        scc,
        solutions,
        callConstraints,
        fnConstraintCache,
      );
      const constraints = iteration.run();
      allConstraints.push(...constraints);
      allNodes.push(...scc);
    }

    // solve all constraints together so cross-SCC data flows in one pass
    const sharedState = new Map<PlaceId, PossibleValues>();
    const solution = solve(allConstraints, sharedState);
    for (const node of allNodes) {
      solutions.set(node, solution);
    }

    // phase 2: update call graph with discovered call targets
    debug("\nphase 2: processing", callConstraints.length, "call constraints");
    for (const constraint of callConstraints) {
      debug("  call constraint: callee=", constraint.callee, "caller=", constraint.caller.hash, "result=", constraint.result);
      const solution = solutions.get(constraint.caller);
      if (!solution) { debug("    no solution for caller"); continue; }
      const calleeValues = solution.state.get(constraint.callee);
      if (!calleeValues) { debug("    callee place not in solution"); continue; }
      debug("    callee resolves to:", [...calleeValues.functions].map((f: any) => f.label ?? f.hash));

      for (const calleeFn of calleeValues.functions) {
        if (calleeFn instanceof Instantiation) continue; // already processed
        const calleeFnExpr = calleeFn as FunctionExpr;

        // get or collect the callee's body constraints
        let bodyConstraints = fnConstraintCache.get(calleeFnExpr);
        if (!bodyConstraints) {
          // create a temporary Iteration to walk the function body
          const tmpIteration = new Iteration(
            placeMap,
            [],
            solutions,
            [],
            fnConstraintCache,
          );
          bodyConstraints = tmpIteration.collectFnConstraints(calleeFnExpr);
        }

        const fnInfo = placeMap.functions.get(calleeFnExpr)!;

        // instantiate: clone constraints with fresh places
        const { rewrite, newConstraints } = instantiateConstraints(
          bodyConstraints,
          fnInfo.owner,
          placeMap.nesting,
        );

        // map the original params and return to their instantiated versions
        const instParams = fnInfo.params.map(
          (p) => rewrite.get(p) ?? p,
        );
        const instReturn = rewrite.get(fnInfo.returnVar) ?? fnInfo.returnVar;

        // wire args → instantiated params
        // keep PlaceId refs as-is — solver will propagate when values arrive
        const wireConstraints: Constraint[] = [];
        for (let j = 0; j < constraint.args.length; j++) {
          const arg = constraint.args[j];
          if (arg != null && instParams[j] != null) {
            wireConstraints.push(
              new SubsetConstraint(instParams[j], arg),
            );
          }
        }
        // wire instantiated return → call result
        wireConstraints.push(
          new SubsetConstraint(constraint.result, instReturn),
        );

        const allConstraints = [...newConstraints, ...wireConstraints];

        // build hash for dedup
        const hash = `${calleeFnExpr.label}@${constraint.result}`;

        const inst = new Instantiation(
          calleeFnExpr,
          constraint.args.map((a) =>
            a instanceof PossibleValues
              ? a
              : new PossibleValues(),
          ),
          rewrite,
          allConstraints,
          instParams,
          instReturn,
          hash,
        );

        callgraph.addEdge(constraint.caller, inst);
      }
    }

    if (!callgraph.dirty) {
      break;
    }

    sccs = callgraph.sccs();
  }

  if (callgraph.dirty) {
    throw new Error("analysis failed to converge after 5000 iterations");
  }

  const merged = new Map<PlaceId, PossibleValues>();
  for (const solution of solutions.values()) {
    for (const [placeId, values] of solution.state) {
      const existing = merged.get(placeId);
      if (existing) {
        existing.addAll(values);
      } else {
        merged.set(
          placeId,
          new PossibleValues(
            new Set(values.objects),
            new Set(values.functions),
          ),
        );
      }
    }
  }

  return merged;
}

type FunctionNode = Program | FunctionExpr;

class Iteration {
  private constraints: Constraint[] = [];
  /** Which function body we're currently walking (for return wiring) */
  private currentFunction!: FunctionNode;
  /** The SCC GraphNode that owns the current solve (for CallConstraint.caller) */
  private currentCaller!: GraphNode;

  constructor(
    private placeMap: PlaceMap,
    private functions: GraphNode[],
    private solutions: Map<GraphNode, SolverResult>,
    private callConstraints: CallConstraint[],
    private fnConstraintCache: Map<FunctionExpr, Constraint[]>,
  ) {}

  run() {
    for (const fn of this.functions) {
      this.currentCaller = fn;
      if (fn instanceof Instantiation) {
        // Instantiation nodes carry pre-made constraints — add them directly
        this.currentFunction = fn.expr;
        for (const c of fn.constraints) {
          if (c instanceof CallConstraint) {
            c.caller = this.currentCaller;
            this.callConstraints.push(c);
          }
          this.constraints.push(c);
        }
      } else {
        // Program node — walk body
        this.currentFunction = fn;
        for (const stmt of fn.body) {
          const flow = this.stmt(stmt);
          if (flow !== "continue") break;
        }
      }
    }

    return this.constraints;
  }

  /**
   * Walk a function body to collect its constraints.
   * Results cached in the shared fnConstraintCache.
   */
  /** Functions currently being collected (for cycle detection) */
  private collecting = new Set<FunctionExpr>();

  collectFnConstraints(fnExpr: FunctionExpr): Constraint[] {
    const cached = this.fnConstraintCache.get(fnExpr);
    if (cached) return cached;

    // cycle detection: if we're already collecting this function, return empty
    // the call will be resolved via CallConstraint in a later iteration
    if (this.collecting.has(fnExpr)) return [];

    this.collecting.add(fnExpr);

    // Save current state
    const savedConstraints = this.constraints;
    const savedFunction = this.currentFunction;
    const savedCallConstraints = this.callConstraints;

    // Walk the function body into a fresh constraint array
    // Use a dummy callConstraints to avoid leaking original-place CallConstraints
    // into the outer callConstraints array (they'll be instantiated later)
    this.constraints = [];
    this.callConstraints = [];
    this.currentFunction = fnExpr;

    for (const stmt of fnExpr.body) {
      const flow = this.stmt(stmt);
      if (flow !== "continue") break;
    }

    const fnConstraints = this.constraints;
    this.fnConstraintCache.set(fnExpr, fnConstraints);

    // Restore state
    this.constraints = savedConstraints;
    this.callConstraints = savedCallConstraints;
    this.currentFunction = savedFunction;
    this.collecting.delete(fnExpr);

    return fnConstraints;
  }

  /** Returns "continue" if control flows to next stmt, "break" to exit loop, "return" to exit function */
  stmt(stmt: Stmt): "continue" | "break" | "return" {
    switch (stmt.kind) {
      case "expr":
        this.expr(stmt.expr);
        return "continue";
      case "let": {
        const lhs = this.placeMap.variables.get(stmt)!;
        if (stmt.init) {
          const rhs = this.expr(stmt.init);
          if (rhs != null) this.constraints.push(new SubsetConstraint(lhs, rhs));
        }
        return "continue";
      }
      case "if": {
        let firstFlow: "continue" | "break" | "return" = "continue";
        for (const s of stmt.then) {
          firstFlow = this.stmt(s);
          if (firstFlow !== "continue") break;
        }

        let secondFlow: "continue" | "break" | "return" = "continue";
        if (stmt.else_) {
          for (const s of stmt.else_) {
            secondFlow = this.stmt(s);
            if (secondFlow !== "continue") break;
          }
        }

        // if either branch continues, the whole if continues
        if (firstFlow === "continue" || secondFlow === "continue") return "continue";
        // if both return, the whole if returns
        if (firstFlow === "return" && secondFlow === "return") return "return";
        // mixed break/return: conservatively continue (break only meaningful inside loop)
        return "continue";
      }
      case "loop": {
        for (const s of stmt.body) {
          const flow = this.stmt(s);
          if (flow === "break") break;
          if (flow === "return") return "return"; // return propagates past loop
        }
        return "continue";
      }
      case "break":
        return "break";
      case "return": {
        debug("processing return at line", stmt.line);
        if (stmt.value) {
          const fnInfo = this.placeMap.functions.get(this.currentFunction)!;
          const expr = this.expr(stmt.value);
          if (expr != null)
            this.constraints.push(new SubsetConstraint(fnInfo.returnVar, expr));
          debug(
            "we're wiring this up to the return for",
            this.currentFunction.hash,
          );
        }
        return "return";
      }
      case "block": {
        for (const stmt2 of stmt.body) {
          const flow = this.stmt(stmt2);
          if (flow !== "continue") return flow;
        }
        return "continue";
      }
    }
  }

  expr(expr: Expr): PlaceId | PossibleValues | null {
    switch (expr.kind) {
      case "ident":
      case "function": {
        return this.placeMap.exprResolution.get(expr)!;
      }
      case "number":
      case "null":
        return new PossibleValues();
      case "object": {
        const result = this.placeMap.exprResolution.get(expr)!;

        // this is why you have an IR but we'll make do for this prototype
        const objId = (result as PossibleValues).objects
          .values()
          .next().value!;

        for (const prop of expr.properties) {
          const fieldVar = objectField(objId, prop.key);
          const rhs = this.expr(prop.value);
          if (rhs != null)
            this.constraints.push(new SubsetConstraint(fieldVar, rhs));
        }

        return result;
      }
      case "call": {
        debug("processing call @ line", expr.line);
        const callee = this.expr(expr.callee);
        debug("got callee for call", callee);
        const place = this.placeMap.exprResolution.get(expr)! as PlaceId;
        debug("we're assigning to", place);

        let possibleCallees = null;
        if (callee instanceof PossibleValues) {
          possibleCallees = callee.functions;
          debug(
            "we know the functions statically",
            [...callee.functions].map((n) => n.hash),
          );
        } else if (typeof callee === "number") {
          // callee is a PlaceId — indirect call
          const combined = new Set<FunctionExpr>();
          for (const solution of this.solutions.values()) {
            const exists = solution.state.get(callee);
            if (exists) {
              for (const fn of exists.functions) combined.add(fn as FunctionExpr);
            }
          }
          debug(
            "for the previous solutions we have",
            [...combined].map((n) => n.hash),
          );
          if (combined.size > 0) {
            possibleCallees = combined;
          } else {
            debug("we're emitting a callconstraint and leaving it be");
            const argPlaces: (PlaceId | PossibleValues | null)[] = [];
            for (let i = 0; i < expr.args.length; i++) {
              argPlaces.push(this.expr(expr.args[i]));
            }
            const callConstraint = new CallConstraint(
              place,
              callee,
              argPlaces,
              this.currentCaller,
            );
            this.callConstraints.push(callConstraint);
            this.constraints.push(callConstraint);
          }
        }

        if (possibleCallees) {
          for (const calleeFn of possibleCallees) {
            if (calleeFn instanceof Instantiation) continue;
            const calleeFnExpr = calleeFn as FunctionExpr;
            const fnInfo = this.placeMap.functions.get(calleeFnExpr)!;
            debug("we're wiring up", calleeFnExpr.label, "in this call");

            // collect the function body's constraints
            const bodyConstraints = this.collectFnConstraints(calleeFnExpr);

            // instantiate: clone with fresh places
            const { rewrite, newConstraints } = instantiateConstraints(
              bodyConstraints,
              fnInfo.owner,
              this.placeMap.nesting,
            );

            // map params and return to their instantiated versions
            const instParams = fnInfo.params.map(
              (p) => rewrite.get(p) ?? p,
            );
            const instReturn = rewrite.get(fnInfo.returnVar) ?? fnInfo.returnVar;

            // wire args → instantiated params
            for (let i = 0; i < expr.args.length; i++) {
              const arg = this.expr(expr.args[i]);
              if (arg != null && instParams[i] != null)
                this.constraints.push(
                  new SubsetConstraint(instParams[i], arg),
                );
            }

            // wire instantiated return → call result
            this.constraints.push(
              new SubsetConstraint(place, instReturn),
            );

            // add instantiated body constraints, fixing up CallConstraint callers
            for (const c of newConstraints) {
              if (c instanceof CallConstraint) {
                c.caller = this.currentCaller;
                this.callConstraints.push(c);
              }
              this.constraints.push(c);
            }
          }
        }

        return place;
      }
      case "member": {
        debug("processing member @ line", expr.line);
        const object = this.expr(expr.object);
        debug("got base for member", object);
        const place = this.placeMap.exprResolution.get(expr)! as PlaceId;
        debug("we're assigning to", place);

        if (object != null) {
          if (typeof object === "number") {
            // object is a PlaceId
            this.constraints.push(
              new FieldLoadConstraint(place, object, expr.property),
            );
            debug(
              "since base is a place, we inserted a field load",
              expr.property,
            );
          } else {
            debug(
              "since object can be unrolled, we flowed just",
              expr.property,
              "into the place",
            );
            for (const objectFieldPlace of object.field(expr.property)) {
              this.constraints.push(
                new SubsetConstraint(place, objectFieldPlace),
              );
            }
          }
        } else {
          console.warn(
            `member index at line ${expr.line} is probably not valid`,
          );
        }

        return place;
      }
      case "assign": {
        debug("processing assignment @ line", expr.line);
        const value = this.expr(expr.value);
        if (value == null) return value;
        if (expr.target.kind === "ident") {
          const toVariable = this.placeMap.exprResolution.get(
            expr.target,
          )! as PlaceId;
          debug("we're doing a direct assignment", toVariable, "=", value);
          this.constraints.push(new SubsetConstraint(toVariable, value));
        } else if (expr.target.kind === "member") {
          const base = this.expr(expr.target.object);
          debug("found the base of the member assignment", base);
          if (base != null) {
            if (typeof base === "number") {
              // base is a PlaceId
              this.constraints.push(
                new FieldStoreConstraint(base, expr.target.property, value),
              );
              debug("doing a field store constraint since base is a place");
            } else {
              for (const baseFieldPlace of base.field(expr.target.property)) {
                this.constraints.push(
                  new SubsetConstraint(baseFieldPlace, value),
                );
              }
              debug(
                "simplifying the field store since the object is statically known",
              );
            }
          } else {
            console.warn(
              `member index at line ${expr.line} is probably not valid`,
            );
          }
        }
        return value;
      }
    }
  }
}
