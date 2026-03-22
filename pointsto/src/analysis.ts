import { HashSet } from "ts-hash";
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
  Constraint,
  FieldLoadConstraint,
  FieldStoreConstraint,
  Place,
  PossibleValues,
  solve,
  SubsetConstraint,
} from "./kleene.js";
import { buildPlaces, PlaceMap } from "./places.js";

const todo = (): never => {
  throw new Error("todo");
};

export function analyze(program: Program): Map<Place, PossibleValues> {
  // run IR
  const placeMap = buildPlaces(program);

  const callgraph = new CallGraph();
  let solution: Map<Place, PossibleValues> = new Map();

  let sccs: FunctionNode[][] = [[program]];
  for (let i = 0; i < 5000; i++) {
    callgraph.clearDirty();

    for (const scc of sccs) {
      const iteration = new Iteration(placeMap, scc, solution);
      const constraints = iteration.run();
      solution = solve(constraints).state;

      // add to callgraph
      for (const fn of scc) {
        const callees = placeMap.calleeResolution.get(fn);
        if (!callees) continue;
        for (const callee of callees) {
          if (callee instanceof Place) {
            const possibleValues = solution.get(callee);
            if (!possibleValues) continue;
            for (const calleeFnExpr of possibleValues.functions) {
              callgraph.addEdge(fn, calleeFnExpr);
            }
          } else {
            callgraph.addEdge(fn, callee);
          }
        }
      }
    }

    if (!callgraph.dirty) {
      break;
    }

    sccs = callgraph.sccs();
  }

  return solution;
}

class Iteration {
  private constraints: Constraint[] = [];
  private currentFunction!: FunctionNode;

  private returnVar: Map<FunctionNode, Place> = new Map();

  constructor(
    private placeMap: PlaceMap,
    private functions: FunctionNode[],
    private solution: Map<Place, PossibleValues> = new Map(),
  ) {}

  run() {
    for (const fn of this.functions) {
      this.currentFunction = fn;
      for (const stmt of fn.body) {
        this.stmt(stmt);
      }
    }

    return this.constraints;
  }

  stmt(stmt: Stmt) {
    switch (stmt.kind) {
      case "expr":
        this.expr(stmt.expr);
        break;
      case "let": {
        const lhs = this.placeMap.variables.get(stmt)!;
        if (stmt.init) {
          const rhs = this.expr(stmt.init);
          if (rhs) this.constraints.push(new SubsetConstraint(lhs, rhs));
        }
        break;
      }
      case "if":
        return todo();
      case "loop":
        return todo();
      case "break":
        return todo();
      case "return":
        // need to stop walking the branch here
        return todo();
      case "block": {
        for (const stmt2 of stmt.body) this.stmt(stmt2);
      }
    }
  }

  expr(expr: Expr): Place | PossibleValues | null {
    switch (expr.kind) {
      case "ident":
      case "function": {
        return this.placeMap.exprResolution.get(expr)!;
      }
      case "number":
      case "null":
        return null;
      case "object": {
        const result = this.placeMap.exprResolution.get(expr)!;

        // this is why you have an IR but we'll make do for this prototype
        const object = (result as PossibleValues).objects
          .values()
          .next().value!;

        for (const prop of expr.properties) {
          const fieldVar = object.field(prop.key);
          const rhs = this.expr(prop.value);
          if (rhs) this.constraints.push(new SubsetConstraint(fieldVar, rhs));
        }

        // theoretically we could optimize this at all depths
        // because currently the fields have their own places
        // but we'll just leave it at depth one
        return result;
      }
      case "call": {
        const place = this.placeMap.exprResolution.get(expr)! as Place;
        const callee = this.expr(expr.callee);

        // TODO: instantiate and process returns if previous solution found

        return place;
      }
      case "member": {
        const place = this.placeMap.exprResolution.get(expr)! as Place;
        const object = this.expr(expr.object);

        if (object) {
          if (object instanceof Place) {
            this.constraints.push(
              new FieldLoadConstraint(place, object, expr.property),
            );
          } else {
            // so we just received, let's say, an object,
            // for example
            // { foo: 1 }.foo
            // we know the place of obj { foo } for sure, so we'll just use that
            // and flow the values of obj { foo } into the place of obj.foo
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
        const value = this.expr(expr.value);
        if (!value) return value;
        if (expr.target.kind === "ident") {
          const toVariable = this.placeMap.exprResolution.get(
            expr.target,
          )! as Place;
          this.constraints.push(new SubsetConstraint(toVariable, value));
        } else if (expr.target.kind === "member") {
          const base = this.expr(expr.target.object);
          if (base) {
            if (base instanceof Place) {
              this.constraints.push(
                new FieldStoreConstraint(base, expr.target.property, value),
              );
            } else {
              // we might as well
              // { foo: 1 }.foo = 2;
              for (const baseFieldPlace of base.field(expr.target.property)) {
                this.constraints.push(
                  new SubsetConstraint(baseFieldPlace, value),
                );
              }
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
