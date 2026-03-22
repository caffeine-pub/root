// ---- Expressions ----

export type Expr =
  | IdentExpr
  | NumberLit
  | NullLit
  | ObjectLit
  | FunctionExpr
  | CallExpr
  | MemberExpr
  | AssignExpr;

export interface IdentExpr {
  kind: "ident";
  name: string;
  line: number;
}

export interface NumberLit {
  kind: "number";
  value: number;
  line: number;
}

export interface NullLit {
  kind: "null";
  line: number;
}

export interface ObjectLit {
  kind: "object";
  properties: { key: string; value: Expr }[];
  line: number;
  hash: string;
}

export interface FunctionExpr {
  kind: "function";
  params: string[];
  body: Stmt[];
  line: number;
  hash: string;
}

export interface CallExpr {
  kind: "call";
  callee: Expr;
  args: Expr[];
  line: number;
}

export interface MemberExpr {
  kind: "member";
  object: Expr;
  property: string;
  line: number;
}

export interface AssignExpr {
  kind: "assign";
  target: IdentExpr | MemberExpr;
  value: Expr;
  line: number;
}

// ---- Statements ----

export type Stmt =
  | ExprStmt
  | LetStmt
  | IfStmt
  | LoopStmt
  | BreakStmt
  | ReturnStmt
  | BlockStmt;

export interface ExprStmt {
  kind: "expr";
  expr: Expr;
}

export interface LetStmt {
  kind: "let";
  name: string;
  init: Expr | null;
  line: number;
}

export interface IfStmt {
  kind: "if";
  then: Stmt[];
  else_: Stmt[] | null;
  line: number;
}

export interface LoopStmt {
  kind: "loop";
  body: Stmt[];
  line: number;
}

export interface BreakStmt {
  kind: "break";
  line: number;
}

export interface ReturnStmt {
  kind: "return";
  value: Expr | null;
  line: number;
}

export interface BlockStmt {
  kind: "block";
  body: Stmt[];
}

export interface Program {
  body: Stmt[];
}
