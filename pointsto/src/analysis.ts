import type {
  Expr,
  FunctionExpr,
  IdentExpr,
  MemberExpr,
  Program,
  Stmt,
} from "./ast.js";
import { CallGraph, FunctionNode } from "./callgraph.js";
import {
  AbstractObject,
  CallConstraint,
  Constraint,
  FieldLoadConstraint,
  FieldStoreConstraint,
  Place,
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

export function analyze(program: Program): Map<Place, PossibleValues> {
  // run IR
  const placeMap = buildPlaces(program);

  const callgraph = new CallGraph();
  let solutions: Map<FunctionNode, SolverResult> = new Map();

  let sccs: FunctionNode[][] = [[program]];
  for (let i = 0; i < 5000; i++) {
    debug("\niteration", i);
    callgraph.clearDirty();

    // phase 1: solve all SCCs
    const iterations: Iteration[] = [];
    for (const scc of sccs) {
      debug(
        "\nprocessing SCC:",
        scc.map((n) => n.hash),
      );

      const iteration = new Iteration(placeMap, scc, solutions);
      const constraints = iteration.run();
      // debug(constraints);
      const solution = solve(constraints);

      for (const fn of scc) {
        solutions.set(fn, solution);
      }
      iterations.push(iteration);
    }

    // phase 2: update call graph
    // direct call edges from constraint generation
    for (const iteration of iterations) {
      for (const [caller, callee] of iteration.directCallEdges) {
        callgraph.addEdge(caller, callee);
      }
    }
    // indirect call edges from solved state
    for (const [fn, solution] of solutions) {
      for (const constraint of solution.constraints) {
        if (constraint instanceof CallConstraint) {
          const calleeValues = solution.state.get(constraint.callee);
          if (!calleeValues) continue;
          for (const calleeFnExpr of calleeValues.functions) {
            callgraph.addEdge(fn, calleeFnExpr);
          }
        }
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

  const merged = new Map<Place, PossibleValues>();
  for (const solution of solutions.values()) {
    for (const [place, values] of solution.state) {
      const existing = merged.get(place);
      if (existing) {
        existing.addAll(values);
      } else {
        merged.set(
          place,
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
  private currentFunction!: FunctionNode;

  private returnVar: Map<FunctionNode, Place> = new Map();

  /** direct call edges discovered during constraint generation */
  public directCallEdges: [FunctionNode, FunctionExpr][] = [];

  constructor(
    private placeMap: PlaceMap,
    private functions: FunctionNode[],
    private solutions: Map<FunctionNode, SolverResult>,
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
          if (rhs) this.constraints.push(new SubsetConstraint(lhs, rhs));
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

  expr(expr: Expr): Place | PossibleValues {
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
        const object = (result as PossibleValues).objects
          .values()
          .next().value!;

        for (const prop of expr.properties) {
          const fieldVar = object.field(prop.key);
          const rhs = this.expr(prop.value);
          this.constraints.push(new SubsetConstraint(fieldVar, rhs));
        }

        // theoretically we could optimize this at all depths
        // because currently the fields have their own places
        // but we'll just leave it at depth one
        return result;
      }
      case "call": {
        debug("processing call @ line", expr.line);
        const callee = this.expr(expr.callee);
        debug("got callee for call", callee);
        const place = this.placeMap.exprResolution.get(expr)! as Place;
        debug("we're assigning to", place);

        let possibleCallees = null;
        if (callee instanceof PossibleValues) {
          possibleCallees = callee.functions;
          debug(
            "we know the functions statically",
            [...callee.functions].map((n) => n.hash),
          );
        } else if (callee instanceof Place) {
          // check ALL solutions — a param like `f` in `apply(f, x)`
          // only gets its value through instantiation in the caller's
          // constraint set, not in the callee's own solution
          const combined = new Set<FunctionExpr>();
          for (const solution of this.solutions.values()) {
            const exists = solution.state.get(callee);
            if (exists) {
              for (const fn of exists.functions) combined.add(fn);
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
            const argPlaces: (Place | PossibleValues | null)[] = [];
            for (let i = 0; i < expr.args.length; i++) {
              argPlaces.push(this.expr(expr.args[i]));
            }
            this.constraints.push(new CallConstraint(place, callee, argPlaces));
          }
        }

        if (possibleCallees) {
          for (const calleeFn of possibleCallees) {
            const fnInfo = this.placeMap.functions.get(calleeFn)!;
            // if (this.functions.includes(calleeFn)) {
            debug("we're wiring up", calleeFn.hash, "in this call");
            // params
            for (let i = 0; i < expr.args.length; i++) {
              const arg = this.expr(expr.args[i]);
              if (arg)
                this.constraints.push(
                  new SubsetConstraint(fnInfo.params[i], arg),
                );
            }

            // return value
            this.constraints.push(
              new SubsetConstraint(place, fnInfo.returnVar),
            );
            // } else {
            // TODO: instantiation needs to be done for context sensitivity
            // debug("we're instantiating", calleeFn.hash, "in this call");
            // // instantiate
            // const calleeSolution = assert(this.solutions.get(calleeFn));
            // const instantiated = calleeSolution.instantiate(fnInfo.level);

            // // TODO: cache these instantiations

            // // params
            // for (let i = 0; i < expr.args.length; i++) {
            //   const arg = this.expr(expr.args[i]);
            //   const param =
            //     instantiated.rewrite.get(fnInfo.params[i]) ??
            //     fnInfo.params[i];
            //   if (arg)
            //     this.constraints.push(new SubsetConstraint(param, arg));
            // }

            // // function body
            // this.constraints.push(...instantiated.newConstraints);

            // // return value
            // const returnVar =
            //   instantiated.rewrite.get(fnInfo.returnVar) ?? fnInfo.returnVar;
            // this.constraints.push(new SubsetConstraint(place, returnVar));
            // }
          }
        }

        return place;
      }
      case "member": {
        debug("processing member @ line", expr.line);
        const object = this.expr(expr.object);
        debug("got base for member", object);
        const place = this.placeMap.exprResolution.get(expr)! as Place;
        debug("we're assigning to", place);

        if (object) {
          if (object instanceof Place) {
            this.constraints.push(
              new FieldLoadConstraint(place, object, expr.property),
            );
            debug(
              "since base is a place, we inserted a field load",
              expr.property,
            );
          } else {
            // so we just received, let's say, an object,
            // for example
            // { foo: 1 }.foo
            // we know the place of obj { foo } for sure, so we'll just use that
            // and flow the values of obj { foo } into the place of obj.foo
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
        if (!value) return value;
        if (expr.target.kind === "ident") {
          const toVariable = this.placeMap.exprResolution.get(
            expr.target,
          )! as Place;
          debug("we're doing a direct assignment", toVariable, "=", value);
          this.constraints.push(new SubsetConstraint(toVariable, value));
        } else if (expr.target.kind === "member") {
          const base = this.expr(expr.target.object);
          debug("found the base of the member assignment", base);
          if (base) {
            if (base instanceof Place) {
              this.constraints.push(
                new FieldStoreConstraint(base, expr.target.property, value),
              );
              debug("doing a field store constraint since base is a place");
            } else {
              // we might as well
              // { foo: 1 }.foo = 2;
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
