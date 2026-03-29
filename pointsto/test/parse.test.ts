import { describe, it, expect } from "vitest";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import type { Program, Stmt, Expr } from "../src/ast.js";

function p(source: string): Program {
  return parse(lex(source));
}

function firstExpr(source: string): Expr {
  const prog = p(source);
  const stmt = prog.body[0]!;
  if (stmt.kind !== "expr") throw new Error("expected expr stmt");
  return stmt.expr;
}

describe("lexer", () => {
  it("lexes identifiers and keywords", () => {
    const tokens = lex("let x = y");
    expect(tokens.map((t) => t.value)).toEqual(["let", "x", "=", "y", ""]);
  });

  it("lexes numbers", () => {
    const tokens = lex("42 3.14");
    expect(tokens[0]!.value).toBe("42");
    expect(tokens[1]!.value).toBe("3.14");
  });

  it("lexes strings", () => {
    const tokens = lex('"hello"');
    expect(tokens[0]!.value).toBe("hello");
  });

  it("lexes labels", () => {
    const tokens = lex("'abc");
    expect(tokens[0]!.value).toBe("abc");
  });

  it("lexes two-char operators", () => {
    const tokens = lex("== != <= >= && ||");
    expect(tokens.map((t) => t.value)).toEqual(["==", "!=", "<=", ">=", "&&", "||", ""]);
  });

  it("skips line comments", () => {
    const tokens = lex("x // comment\ny");
    expect(tokens.map((t) => t.value)).toEqual(["x", "y", ""]);
  });

  it("skips block comments", () => {
    const tokens = lex("x /* comment */ y");
    expect(tokens.map((t) => t.value)).toEqual(["x", "y", ""]);
  });
});

describe("parser", () => {
  it("parses let declarations", () => {
    const prog = p("let x = 42;");
    expect(prog.body).toHaveLength(1);
    const stmt = prog.body[0]!;
    expect(stmt.kind).toBe("let");
    if (stmt.kind === "let") {
      expect(stmt.name).toBe("x");
      expect(stmt.init?.kind).toBe("number");
    }
  });

  it("parses let without init", () => {
    const prog = p("let x;");
    const stmt = prog.body[0]!;
    if (stmt.kind === "let") {
      expect(stmt.init).toBeNull();
    }
  });

  it("parses arrow functions", () => {
    const expr = firstExpr("'f: (x) => { return x; }");
    expect(expr.kind).toBe("function");
    if (expr.kind === "function") {
      expect(expr.params).toEqual(["x"]);
    }
  });

  it("parses no-param arrow", () => {
    const expr = firstExpr("'f: () => { return 1; }");
    expect(expr.kind).toBe("function");
    if (expr.kind === "function") {
      expect(expr.params).toEqual([]);
    }
  });

  it("parses arrow via let + assignment", () => {
    const prog = p("let foo = 'f: (a, b) => { return a; };");
    const stmt = prog.body[0]!;
    expect(stmt.kind).toBe("let");
    if (stmt.kind === "let") {
      expect(stmt.name).toBe("foo");
      expect(stmt.init?.kind).toBe("function");
      if (stmt.init?.kind === "function") {
        expect(stmt.init.params).toEqual(["a", "b"]);
      }
    }
  });

  it("parses forward declarations", () => {
    const prog = p("let f;\nf = 'g: (x) => { return x; };");
    expect(prog.body).toHaveLength(2);
    const decl = prog.body[0]!;
    expect(decl.kind).toBe("let");
    if (decl.kind === "let") {
      expect(decl.name).toBe("f");
      expect(decl.init).toBeNull();
    }
    const assign = prog.body[1]!;
    expect(assign.kind).toBe("expr");
    if (assign.kind === "expr") {
      expect(assign.expr.kind).toBe("assign");
    }
  });

  it("parses object literals", () => {
    const prog = p("let o = 'obj: { x: 1, y: 2 };");
    const stmt = prog.body[0]!;
    expect(stmt.kind).toBe("let");
    if (stmt.kind === "let") {
      expect(stmt.init?.kind).toBe("object");
      if (stmt.init?.kind === "object") {
        expect(stmt.init.properties).toHaveLength(2);
        expect(stmt.init.properties[0]!.key).toBe("x");
        expect(stmt.init.properties[1]!.key).toBe("y");
      }
    }
  });

  it("parses shorthand properties", () => {
    const prog = p("let x = 1; let o = 'obj: { x };");
    const stmt = prog.body[1]!;
    if (stmt.kind === "let" && stmt.init?.kind === "object") {
      expect(stmt.init.properties[0]!.key).toBe("x");
      expect(stmt.init.properties[0]!.value.kind).toBe("ident");
    }
  });

  it("parses member access", () => {
    const expr = firstExpr("a.b.c");
    expect(expr.kind).toBe("member");
    if (expr.kind === "member") {
      expect(expr.property).toBe("c");
      expect(expr.object.kind).toBe("member");
    }
  });

  it("parses function calls", () => {
    const expr = firstExpr("foo(1, 2)");
    expect(expr.kind).toBe("call");
    if (expr.kind === "call") {
      expect(expr.callee.kind).toBe("ident");
      expect(expr.args).toHaveLength(2);
    }
  });

  it("parses method calls", () => {
    const expr = firstExpr("a.b(1)");
    expect(expr.kind).toBe("call");
    if (expr.kind === "call") {
      expect(expr.callee.kind).toBe("member");
    }
  });

  it("parses assignment", () => {
    const expr = firstExpr("x = 1");
    expect(expr.kind).toBe("assign");
    if (expr.kind === "assign") {
      expect(expr.target.kind).toBe("ident");
      expect(expr.value.kind).toBe("number");
    }
  });

  it("parses member assignment", () => {
    const expr = firstExpr("a.b = 1");
    expect(expr.kind).toBe("assign");
    if (expr.kind === "assign") {
      expect(expr.target.kind).toBe("member");
    }
  });

  it("parses loop/break", () => {
    const prog = p("loop { break; }");
    const stmt = prog.body[0]!;
    expect(stmt.kind).toBe("loop");
    if (stmt.kind === "loop") {
      expect(stmt.body).toHaveLength(1);
      expect(stmt.body[0]!.kind).toBe("break");
    }
  });

  it("parses closures capturing variables", () => {
    const prog = p(`
      let x = 1;
      let f = 'f: () => { return x; };
      f();
    `);
    expect(prog.body).toHaveLength(3);
  });

  it("parses object with function fields", () => {
    const prog = p(`
      let obj = 'obj: {
        handler: 'h: (x) => { return x; },
        value: 42
      };
      obj.handler(1);
    `);
    expect(prog.body).toHaveLength(2);
  });

  it("parses trailing commas in objects and calls", () => {
    const prog = p("let o = 'obj: { x: 1, y: 2, };");
    const stmt = prog.body[0]!;
    if (stmt.kind === "let") {
      expect(stmt.init?.kind).toBe("object");
    }
  });

  it("parses optional semicolons", () => {
    const prog = p("let x = 1\nlet y = 2\n");
    expect(prog.body).toHaveLength(2);
  });

  it("parses arrow functions as arguments", () => {
    const expr = firstExpr("foo('f: (x) => { return x; })");
    expect(expr.kind).toBe("call");
    if (expr.kind === "call") {
      expect(expr.args[0]!.kind).toBe("function");
    }
  });

  it("parses chained calls", () => {
    const expr = firstExpr("a(1)(2)(3)");
    expect(expr.kind).toBe("call");
    if (expr.kind === "call") {
      expect(expr.callee.kind).toBe("call");
    }
  });

  it("parses labels on functions", () => {
    const expr = firstExpr("'myFunc: (x) => { return x; }");
    expect(expr.kind).toBe("function");
    if (expr.kind === "function") {
      expect(expr.hash).toBe("myFunc");
    }
  });

  it("parses labels on objects", () => {
    const expr = firstExpr("'myObj: { x: 1 }");
    expect(expr.kind).toBe("object");
    if (expr.kind === "object") {
      expect(expr.hash).toBe("myObj");
    }
  });
});
