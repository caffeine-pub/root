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
import {
  type PlaceId,
  type AbstractObjectId,
  type Owner,
  places,
  objects,
  PossibleValues,
} from "./kleene.js";

export interface FunctionInfo {
  params: PlaceId[];
  returnVar: PlaceId;
  owner: Owner;
}

type FunctionNode = Program | FunctionExpr;

export interface PlaceMap {
  /** variable declarations → their PlaceId */
  variables: Map<LetStmt, PlaceId>;
  /** function/program nodes → params, return var, owner */
  functions: Map<FunctionNode, FunctionInfo>;
  /** what each expression resolves to statically */
  exprResolution: Map<Expr, PlaceId | PossibleValues | null>;
  /** nesting: child owner → parent owner (null for top-level program) */
  nesting: Map<Owner, Owner | null>;
}

class Scope {
  private stack: { name: string; place: PlaceId }[] = [];
  private marks: number[] = [];

  declare(name: string, place: PlaceId) {
    this.stack.push({ name, place });
  }

  lookup(name: string): PlaceId | undefined {
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
  const variables = new Map<LetStmt, PlaceId>();
  const functions = new Map<FunctionNode, FunctionInfo>();
  const exprResolution = new Map<Expr, PlaceId | PossibleValues | null>();
  const nesting = new Map<Owner, Owner | null>();
  const scope = new Scope();
  let fnNodeStack: FunctionNode[] = [program];

  nesting.set(program, null);

  function currentOwner(): Owner {
    return fnNodeStack.at(-1)! as Owner;
  }

  function predeclare(stmts: Stmt[]) {
    for (const stmt of stmts) {
      switch (stmt.kind) {
        case "let": {
          const place = places.alloc(stmt.name, currentOwner());
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
    const owner = currentOwner();
    const paramPlaces: PlaceId[] = [];
    for (const name of params) {
      const place = places.alloc(`${node.hash}.${name}`, owner);
      paramPlaces.push(place);
      scope.declare(name, place);
    }

    const returnVar = places.alloc(`${node.hash}.return`, owner);

    functions.set(node, {
      params: paramPlaces,
      returnVar,
      owner,
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

  function humanReadable(x: PlaceId | PossibleValues | null): string {
    if (x == null) return "unknown";
    if (typeof x === "number") return places.get(x).name;
    const object = x.objects.values().next().value;
    if (object !== undefined) return objects.get(object).name;
    const fn = x.functions.values().next().value;
    return fn?.hash ?? "unknown";
  }

  function walkExpr(expr: Expr): PlaceId | PossibleValues | null {
    let result: PlaceId | PossibleValues | null;

    switch (expr.kind) {
      case "ident": {
        const place = scope.lookup(expr.name);
        if (place !== undefined) {
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
        const objId = objects.alloc(expr.hash, currentOwner());
        for (const prop of expr.properties) {
          walkExpr(prop.value);
        }
        result = new PossibleValues(new Set([objId]));
        break;
      }
      case "function": {
        const parent = currentOwner();
        nesting.set(expr, parent);
        scope.push();
        walkFunction(expr, expr.params);
        scope.pop();
        result = new PossibleValues(new Set(), new Set([expr]));
        break;
      }
      case "call": {
        const callee = walkExpr(expr.callee);
        for (const arg of expr.args) walkExpr(arg);

        result = places.alloc(
          `call(${humanReadable(callee)}@${expr.line})`,
          currentOwner(),
        );
        break;
      }
      case "member": {
        const base = walkExpr(expr.object);
        result = places.alloc(
          `${humanReadable(base)}.${expr.property}@${expr.line}`,
          currentOwner(),
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

  walkFunction(program, []);

  return { variables, functions, exprResolution, nesting };
}
