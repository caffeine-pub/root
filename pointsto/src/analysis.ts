import type {
  Expr,
  FunctionExpr,
  IdentExpr,
  MemberExpr,
  Program,
  Stmt,
} from "./ast.js";
import { CallGraph, GraphNode } from "./callgraph.js";
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

  let sccs: GraphNode[][] = [[program]];
  for (let i = 0; i < 5000; i++) {
    debug("\niteration", i);
    callgraph.clearDirty();

    // phase 1: solve all SCCs
    const iterations: Iteration[] = [];
    const callConstraints: CallConstraint[] = [];
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
      );
      const constraints = iteration.run();
      // debug(constraints);
      const solution = solve(constraints);

      for (const fn of scc) {
        solutions.set(fn, solution);
      }
      iterations.push(iteration);
    }

    // phase 2: update call graph
    for (const constraint of callConstraints) {
      const solution = solutions.get(constraint.caller);
      if (!solution) continue;
      const calleeValues = solution.state.get(constraint.callee);
      if (!calleeValues) continue;
      for (const calleeFnExpr of calleeValues.functions) {
        // TODO: create Instantiation and add as edge
        // callgraph.addEdge(constraint.caller, instantiation);
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

class Iteration {
  private constraints: Constraint[] = [];
  private currentFunction!: GraphNode;

  constructor(
    private placeMap: PlaceMap,
    private functions: GraphNode[],
    private solutions: Map<GraphNode, SolverResult>,
    private callConstraints: CallConstraint[],
  ) {}

  run() {
    for (const fn of this.functions) {
      this.currentFunction = fn;
      for (const stmt of fn.body) {
        const shouldContinue = this.stmt(stmt);
        if (!shouldContinue) break;
      }
    }

    return this.constraints;
  }

  stmt(stmt: Stmt): boolean {
    switch (stmt.kind) {
      case "expr":
        this.expr(stmt.expr);
        return true;
      case "let": {
        const lhs = this.placeMap.variables.get(stmt)!;
        if (stmt.init) {
          const rhs = this.expr(stmt.init);
          if (rhs != null) this.constraints.push(new SubsetConstraint(lhs, rhs));
        }
        return true;
      }
      case "if": {
        let firstContinues = true;
        for (const s of stmt.then) {
          firstContinues = this.stmt(s);
          if (!firstContinues) break;
        }

        let secondContinues = true;
        if (stmt.else_) {
          for (const s of stmt.else_) {
            secondContinues = this.stmt(s);
            if (!secondContinues) break;
          }
        }

        return firstContinues || secondContinues;
      }
      case "loop": {
        for (const s of stmt.body) {
          const shouldContinue = this.stmt(s);
          if (!shouldContinue) break;
        }
        return true;
      }
      case "break":
        return false;
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
        return false;
      }
      case "block": {
        for (const stmt2 of stmt.body) {
          const shouldContinue = this.stmt(stmt2);
          if (!shouldContinue) return false;
        }
        return true;
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
              this.currentFunction,
            );
            this.callConstraints.push(callConstraint);
            this.constraints.push(callConstraint);
          }
        }

        if (possibleCallees) {
          for (const calleeFn of possibleCallees) {
            const fnInfo = this.placeMap.functions.get(calleeFn)!;
            debug("we're wiring up", calleeFn.hash, "in this call");
            // params
            for (let i = 0; i < expr.args.length; i++) {
              const arg = this.expr(expr.args[i]);
              if (arg != null)
                this.constraints.push(
                  new SubsetConstraint(fnInfo.params[i], arg),
                );
            }

            // return value
            this.constraints.push(
              new SubsetConstraint(place, fnInfo.returnVar),
            );
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
