import type {
  AssignExpr,
  CallExpr,
  Expr,
  FunctionExpr,
  LetStmt,
  MemberExpr,
  ObjectLit,
  Program,
  Stmt,
} from "./ast.js";
import { AbstractObject, Place, PossibleValues } from "./kleene.js";
import type { FunctionNode } from "./callgraph.js";

export interface FunctionInfo {
  params: Place[];
  returnVar: Place;
  level: number;
}

export interface PlaceMap {
  /** variable declarations → their Place */
  variables: Map<LetStmt, Place>;
  /** function/program nodes → params, return var, level */
  functions: Map<FunctionNode, FunctionInfo>;
  /** what each expression resolves to statically */
  exprResolution: Map<Expr, Place | PossibleValues | null>;
}

class Scope {
  private stack: { name: string; place: Place }[] = [];
  private marks: number[] = [];

  declare(name: string, place: Place) {
    this.stack.push({ name, place });
  }

  lookup(name: string): Place | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i]!.name === name) return this.stack[i]!.place;
    }
    return undefined;
  }

  push() {
    this.marks.push(this.stack.length);
  }

  pop() {
    this.stack.length = this.marks.pop()!;
  }
}

export function buildPlaces(program: Program): PlaceMap {
  const variables = new Map<LetStmt, Place>();
  const functions = new Map<FunctionNode, FunctionInfo>();
  const exprResolution = new Map<Expr, Place | PossibleValues | null>();
  const scope = new Scope();
  let level = 0;
  let fnNodeStack: FunctionNode[] = [program];

  function predeclare(stmts: Stmt[]) {
    for (const stmt of stmts) {
      switch (stmt.kind) {
        case "let": {
          const place = new Place(stmt.name, level);
          variables.set(stmt, place);
          scope.declare(stmt.name, place);
          break;
        }
        case "if":
          predeclare(stmt.then);
          if (stmt.else_) predeclare(stmt.else_);
          break;
        case "loop":
        case "block":
          predeclare(stmt.body);
          break;
      }
    }
  }

  function walkFunction(node: FunctionNode, params: string[]) {
    fnNodeStack.push(node);
    const paramPlaces: Place[] = [];
    for (const name of params) {
      const place = new Place(`${fnNodeStack.at(-1)!.hash}.${name}`, level);
      paramPlaces.push(place);
      scope.declare(name, place);
    }

    const returnVar = new Place(`${node.hash}.return`, level);

    functions.set(node, {
      params: paramPlaces,
      returnVar,
      level,
    });

    // pre-declare all let bindings so function bodies can forward-reference
    // variables declared later in the same scope (enable forward references)
    predeclare(node.body);

    for (const stmt of node.body) {
      walkStmt(stmt);
    }
    fnNodeStack.pop();
  }

  function walkStmt(stmt: Stmt) {
    switch (stmt.kind) {
      case "let": {
        // place already created in walkFunction's pre-declare pass
        if (stmt.init) walkExpr(stmt.init);
        break;
      }
      case "expr":
        walkExpr(stmt.expr);
        break;
      case "if":
        for (const s of stmt.then) walkStmt(s);
        if (stmt.else_) for (const s of stmt.else_) walkStmt(s);
        break;
      case "loop":
        for (const s of stmt.body) walkStmt(s);
        break;
      case "return":
        if (stmt.value) walkExpr(stmt.value);
        break;
      case "block":
        for (const s of stmt.body) walkStmt(s);
        break;
      case "break":
        break;
    }
  }

  function humanReadable(x: Place | PossibleValues | null) {
    if (!x) return "unknown";
    if (x instanceof Place) return x.name;
    const object = x.objects.values().next().value!;
    const fn = x.functions.values().next().value;
    return object?.name || fn?.hash;
  }

  function walkExpr(expr: Expr): Place | PossibleValues | null {
    let result: Place | PossibleValues | null;

    switch (expr.kind) {
      case "ident": {
        const place = scope.lookup(expr.name);
        if (place) {
          result = place;
        } else {
          throw new Error(
            `no variable ${expr.name} found at line ${expr.line}`,
          );
        }
        break;
      }
      case "number":
      case "null":
        result = null;
        break;
      case "object": {
        const object = new AbstractObject(expr.hash, level);
        for (const prop of expr.properties) {
          walkExpr(prop.value);
        }
        result = new PossibleValues(new Set([object]));
        break;
      }
      case "function": {
        scope.push();
        level++;
        walkFunction(expr, expr.params);
        level--;
        scope.pop();
        result = new PossibleValues(new Set(), new Set([expr]));
        break;
      }
      case "call": {
        const callee = walkExpr(expr.callee);
        for (const arg of expr.args) walkExpr(arg);

        result = new Place(
          `call(${humanReadable(callee)}@${expr.line})`,
          level,
        );
        break;
      }
      case "member": {
        const base = walkExpr(expr.object);
        result = new Place(
          `${humanReadable(base)}.${expr.property}@${expr.line}`,
          level,
        );
        break;
      }
      case "assign": {
        walkExpr(expr.target);
        result = walkExpr(expr.value);
        break;
      }
    }

    exprResolution.set(expr, result);
    return result;
  }

  // program is level 0
  walkFunction(program, []);

  return { variables, functions, exprResolution };
}
