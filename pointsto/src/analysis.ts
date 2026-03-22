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

const todo = (): never => {
  throw new Error("todo");
};

export function analyze(program: Program): Map<Place, PossibleValues> {
  const callgraph = new CallGraph();
  let solution: Map<Place, PossibleValues> = new Map();

  let sccs: FunctionNode[][] = [[program]];
  for (let i = 0; i < 5000; i++) {
    callgraph.clearDirty();

    for (const scc of sccs) {
      const iteration = new Iteration(scc, solution);
      const constraints = iteration.run();
      solution = solve(constraints).state;

      // add to callgraph
      for (const fn of scc) {
        const callees = iteration.callees.get(fn);
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

class Scope {
  private stack: { name: string; value: Place }[] = [];

  declare(name: string, value: Place) {
    this.stack.push({ name, value });
  }

  lookup(name: string) {
    return this.stack.findLast((v) => v.name === name)?.value;
  }

  push() {
    return this.stack.length;
  }

  reset(mark: number) {
    this.stack = this.stack.slice(0, mark);
  }
}

class Iteration {
  private constraints: Constraint[] = [];
  private scope = new Scope();

  private currentFunction!: FunctionNode;
  get level() {
    return this.currentFunction.level;
  }

  private returnVar: Map<FunctionNode, Place> = new Map();
  public callees: Map<FunctionNode, Set<Place | FunctionExpr>> = new Map();

  constructor(
    private functions: FunctionNode[],
    private solution: Map<Place, PossibleValues> = new Map(),
  ) {}

  addCallee(place: Place | FunctionExpr) {
    const exists = this.callees.get(this.currentFunction);
    if (exists) {
      exists.add(place);
    } else {
      this.callees.set(this.currentFunction, new Set([place]));
    }
  }

  run() {
    for (const fn of this.functions) {
      this.returnVar.set(fn, new Place(`return [TODO add detail]`, fn.level));
    }

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
        const lhs = new Place(stmt.name, this.level);
        this.scope.declare(stmt.name, lhs);
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

  // TODO: add PossibleValues to return type
  expr(expr: Expr): Place | PossibleValues | null {
    switch (expr.kind) {
      case "ident": {
        const fromVariable = this.scope.lookup(expr.name);
        // TODO: check if this place resolves to a function we're currently analyzing... somehow
        if (fromVariable) return fromVariable;
        else
          throw new Error(
            `no variable ${expr.name} found at line ${expr.line}`,
          );
      }
      case "number":
      case "null":
        return null;
      case "object": {
        const object = new AbstractObject(expr.hash, this.level);

        for (const prop of expr.properties) {
          const fieldVar = object.field(prop.key);
          const rhs = this.expr(prop.value);
          if (rhs) this.constraints.push(new SubsetConstraint(fieldVar, rhs));
        }

        // theoretically we could optimize this at all depths
        // because currently the fields have their own places
        // but we'll just leave it at depth one
        return new PossibleValues(new Set([object]));
      }
      case "function": {
        return new PossibleValues(new Set(), new Set([expr]));
      }
      case "call": {
        const callee = this.expr(expr.callee);
        if (callee) {
          if (callee instanceof Place) {
            this.addCallee(callee);
          } else {
            for (const fn of callee.functions) {
              this.addCallee(fn);
            }
          }
        } else console.warn(`call at line ${expr.line} is probably not valid`);

        // TODO: instantiate and process returns if previous solution found

        return new Place(`call@${expr.line}`, this.level);
      }
      case "member": {
        const place = new Place(
          `member@${expr.line} .${expr.property}`,
          this.level,
        );
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
          const toVariable = this.scope.lookup(expr.target.name);
          if (toVariable) {
            this.constraints.push(new SubsetConstraint(toVariable, value));
          } else
            throw new Error(
              `no variable ${expr.target.name} found at line ${expr.line}`,
            );
        } else if (expr.target.kind === "member") {
          const base = this.expr(expr.target.object);
          if (base) {
            if (base instanceof Place) {
              this.constraints.push(
                new FieldStoreConstraint(base, expr.target.property, value),
              );
            } else {
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
