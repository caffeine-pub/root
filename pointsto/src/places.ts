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
  /** callee info: for each call expr, the Place or FunctionExprs that could be called */
  calleeResolution: Map<FunctionNode, Set<Place | FunctionExpr>>;
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
  const calleeResolution = new Map<FunctionNode, Set<Place | FunctionExpr>>();
  const scope = new Scope();
  let level = 0;
  let fnNodeStack: FunctionNode[] = [program];

  function addCallee(place: Place | FunctionExpr) {
    const fnNode = fnNodeStack.at(-1)!;
    const exists = calleeResolution.get(fnNode);
    if (exists) {
      exists.add(place);
    } else {
      calleeResolution.set(fnNode, new Set([place]));
    }
  }

  function walkFunction(node: FunctionNode, params: string[]) {
    fnNodeStack.push(node);
    const paramPlaces: Place[] = [];
    for (const name of params) {
      const place = new Place(name, level);
      paramPlaces.push(place);
      scope.declare(name, place);
    }

    const returnVar = new Place(
      `return@${node.kind === "function" ? node.hash : "top"}`,
      level,
    );

    functions.set(node, {
      params: paramPlaces,
      returnVar,
      level,
    });

    // pre-declare all let bindings so function bodies can forward-reference
    // variables declared later in the same scope (like JS hoisting)
    for (const stmt of node.body) {
      if (stmt.kind === "let") {
        const place = new Place(stmt.name, level);
        variables.set(stmt, place);
        scope.declare(stmt.name, place);
      }
    }

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

        // record callee info for analysis to use
        if (callee) {
          if (callee instanceof Place) {
            addCallee(callee);
          } else {
            // direct PossibleValues — we know the functions statically
            for (const calleeFnExpr of callee.functions) {
              addCallee(calleeFnExpr);
            }
          }
        }

        result = new Place(`call@${expr.line}`, level);
        break;
      }
      case "member": {
        walkExpr(expr.object);
        result = new Place(`member@${expr.line} .${expr.property}`, level);
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

  return { variables, functions, exprResolution, calleeResolution };
}
