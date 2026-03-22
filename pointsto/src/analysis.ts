import { HashSet } from "ts-hash";
import type { Expr, Program, Stmt } from "./ast.js";
import { CallGraph } from "./callgraph.js";
import { SubsetConstraint, Variable } from "./kleene.js";

const todo = (): never => {
  throw new Error("todo");
};

export function analyze(program: Program): Map<string, string> {
  const callgraph = new CallGraph();
  const constraints: SubsetConstraint<string>[] = [];
}

class ObjectTracker {
  private lexicalObjectMembers: Map<string, Variable> = new Map();

  index(lhs: string, index: string) {
    return this.lexicalObjectMembers.get(`${lhs}.${index}`);
  }

  indexSet(lhs: string, index: string, value: Variable) {
    this.lexicalObjectMembers.set(`${lhs}.${index}`, value);
  }
}

class Scope {
  private stack: { name: string; value: Variable }[] = [];

  declare(name: string, value: Variable) {
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

type EquationalObject = Map<string, EquationalValue>;

/** Set of possible objects / sets of functions that can be at this variable */
type EquationalValue = Set<EquationalObject | Variable>;

class Iteration {
  private callgraph = new CallGraph();
  private constraints: SubsetConstraint<string>[] = [];
  private scope = new Scope();
  private objectTracker = new ObjectTracker();
  private returnVar: Variable | null = null;
  private callees: Variable[] = [];

  run(program: Program) {
    for (const stmt of program.body) {
      this.stmt(stmt);
    }
  }

  stmt(stmt: Stmt) {
    switch (stmt.kind) {
      case "expr":
        return todo();
      case "let": {
        const variable = new Variable(stmt.name);
        this.scope.declare(stmt.name, variable);
        if (stmt.init) {
          const rhs = this.expr(stmt.init);
          if (rhs) this.constraints.push(new SubsetConstraint(variable, rhs));
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

  expr(expr: Expr): Variable | null {
    switch (expr.kind) {
      case "ident":
        const fromVariable = this.scope.lookup(expr.name);
        if (fromVariable) return fromVariable;
        else
          throw new Error(
            `no variable ${expr.name} found at line ${expr.line}`,
          );
      case "number":
      case "null":
        return null;
      case "object": {
        const set = new HashSet<string>((s) => s);
        set.add(expr.hash);

        const v = new Variable(expr.hash);
        this.constraints.push(new SubsetConstraint(v, set));

        for (const prop of expr.properties) {
          const fieldVar = new Variable(`${expr.hash}.${prop.key}`);
          const rhs = this.expr(prop.value);
          if (rhs) this.constraints.push(new SubsetConstraint(fieldVar, rhs));
          this.objectTracker.indexSet(expr.hash, prop.key, fieldVar);
        }

        return v;
      }
      case "function": {
        const set = new HashSet<string>((s) => s);
        set.add(expr.hash);

        const v = new Variable(expr.hash);
        this.constraints.push(new SubsetConstraint(v, set));

        return v;
      }
      case "call": {
        const callee = this.expr(expr.callee);
        if (callee) this.callees.push(callee);
        else console.warn(`call at line ${expr.line} is probably not valid`);

        // need information from previous iterations to process
        // which functions callee can call

        return new Variable(`call@${expr.line}`);
      }
    }
  }
}
