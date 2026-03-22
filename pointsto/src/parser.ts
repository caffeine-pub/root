import { Token, TokenKind } from "./lexer.js";
import type {
  Expr,
  Stmt,
  Program,
  FunctionExpr,
  ObjectLit,
  AssignExpr,
  IdentExpr,
  MemberExpr,
} from "./ast.js";

export function parse(tokens: Token[]): Program {
  let pos = 0;

  function peek(): Token {
    return tokens[pos]!;
  }

  function advance(): Token {
    return tokens[pos++]!;
  }

  function expect(kind: TokenKind, msg?: string): Token {
    const tok = peek();
    if (tok.kind !== kind) {
      throw new Error(
        `${msg ?? `Expected ${TokenKind[kind]}`}, got ${TokenKind[tok.kind]} '${tok.value}' at ${tok.line}:${tok.col}`
      );
    }
    return advance();
  }

  function at(kind: TokenKind): boolean {
    return peek().kind === kind;
  }

  function eat(kind: TokenKind): Token | null {
    if (at(kind)) return advance();
    return null;
  }

  // ---- Statements ----

  function parseProgram(): Program {
    const body: Stmt[] = [];
    while (!at(TokenKind.EOF)) {
      body.push(parseStmt());
    }
    return { body };
  }

  function parseStmt(): Stmt {
    if (at(TokenKind.Let)) return parseLetStmt();
    if (at(TokenKind.If)) return parseIfStmt();
    if (at(TokenKind.Loop)) return parseLoopStmt();
    if (at(TokenKind.Break)) return parseBreakStmt();
    if (at(TokenKind.Return)) return parseReturnStmt();
    if (at(TokenKind.LBrace)) return parseBlock();
    return parseExprStmt();
  }

  function parseLetStmt(): Stmt {
    const tok = expect(TokenKind.Let);
    const name = expect(TokenKind.Ident, "Expected variable name").value;
    let init: Expr | null = null;
    if (eat(TokenKind.Eq)) {
      init = parseExpr();
    }
    eat(TokenKind.Semicolon);
    return { kind: "let", name, init, line: tok.line };
  }

  function parseIfStmt(): Stmt {
    const tok = expect(TokenKind.If);
    const then = parseBlockBody();
    let else_: Stmt[] | null = null;
    if (eat(TokenKind.Else)) {
      if (at(TokenKind.If)) {
        else_ = [parseIfStmt()];
      } else {
        else_ = parseBlockBody();
      }
    }
    return { kind: "if", then, else_, line: tok.line };
  }

  function parseLoopStmt(): Stmt {
    const tok = expect(TokenKind.Loop);
    const body = parseBlockBody();
    return { kind: "loop", body, line: tok.line };
  }

  function parseBreakStmt(): Stmt {
    const tok = expect(TokenKind.Break);
    eat(TokenKind.Semicolon);
    return { kind: "break", line: tok.line };
  }

  function parseReturnStmt(): Stmt {
    const tok = expect(TokenKind.Return);
    let value: Expr | null = null;
    if (!at(TokenKind.Semicolon) && !at(TokenKind.RBrace) && !at(TokenKind.EOF)) {
      value = parseExpr();
    }
    eat(TokenKind.Semicolon);
    return { kind: "return", value, line: tok.line };
  }

  function parseBlock(): Stmt {
    const body = parseBlockBody();
    return { kind: "block", body };
  }

  function parseBlockBody(): Stmt[] {
    expect(TokenKind.LBrace);
    const stmts: Stmt[] = [];
    while (!at(TokenKind.RBrace) && !at(TokenKind.EOF)) {
      stmts.push(parseStmt());
    }
    expect(TokenKind.RBrace);
    return stmts;
  }

  function parseExprStmt(): Stmt {
    const expr = parseExpr();
    eat(TokenKind.Semicolon);
    return { kind: "expr", expr };
  }

  // ---- Expressions ----

  function parseExpr(): Expr {
    return parseAssign();
  }

  function parseAssign(): Expr {
    const left = parsePostfix();

    if (at(TokenKind.Eq)) {
      advance();
      const value = parseAssign(); // right-associative
      if (left.kind === "ident" || left.kind === "member") {
        return {
          kind: "assign",
          target: left as IdentExpr | MemberExpr,
          value,
          line: left.line,
        } satisfies AssignExpr;
      }
      throw new Error(`Invalid assignment target at ${left.line}`);
    }

    return left;
  }

  function parsePostfix(): Expr {
    let expr = parsePrimary();

    while (true) {
      if (eat(TokenKind.Dot)) {
        const prop = expect(TokenKind.Ident, "Expected property name").value;
        expr = { kind: "member", object: expr, property: prop, line: expr.line };
      } else if (at(TokenKind.LParen)) {
        advance();
        const args: Expr[] = [];
        if (!at(TokenKind.RParen)) {
          args.push(parseExpr());
          while (eat(TokenKind.Comma)) {
            args.push(parseExpr());
          }
        }
        expect(TokenKind.RParen);
        expr = { kind: "call", callee: expr, args, line: expr.line };
      } else if (at(TokenKind.LBracket)) {
        advance();
        const index = parseExpr();
        expect(TokenKind.RBracket);
        expr = { kind: "member", object: expr, property: "??computed", line: expr.line };
      } else {
        break;
      }
    }

    return expr;
  }

  function parsePrimary(): Expr {
    const tok = peek();

    if (at(TokenKind.Number)) {
      advance();
      return { kind: "number", value: parseFloat(tok.value), line: tok.line };
    }

    if (at(TokenKind.Null)) {
      advance();
      return { kind: "null", line: tok.line };
    }

    if (at(TokenKind.Ident)) {
      advance();
      if (at(TokenKind.Arrow)) {
        return parseArrow([tok.value], tok.line);
      }
      return { kind: "ident", name: tok.value, line: tok.line };
    }

    if (at(TokenKind.LBrace)) {
      return parseObjectLit();
    }

    if (at(TokenKind.LParen)) {
      if (isArrowParams()) {
        const params = parseParams();
        return parseArrow(params, tok.line);
      }
      advance();
      const expr = parseExpr();
      expect(TokenKind.RParen);
      return expr;
    }

    throw new Error(
      `Unexpected token ${TokenKind[tok.kind]} '${tok.value}' at ${tok.line}:${tok.col}`
    );
  }

  function parseArrow(params: string[], line: number): FunctionExpr {
    expect(TokenKind.Arrow);
    if (at(TokenKind.LBrace)) {
      const body = parseBlockBody();
      return { kind: "function", params, body, line, hash: `fn@${line}` };
    }
    const expr = parseAssign();
    return { kind: "function", params, body: [{ kind: "return", value: expr, line: expr.line }], line, hash: `fn@${line}` };
  }

  function parseObjectLit(): ObjectLit {
    const tok = expect(TokenKind.LBrace);
    const properties: { key: string; value: Expr }[] = [];

    if (!at(TokenKind.RBrace)) {
      properties.push(parseProperty());
      while (eat(TokenKind.Comma)) {
        if (at(TokenKind.RBrace)) break;
        properties.push(parseProperty());
      }
    }

    expect(TokenKind.RBrace);
    return { kind: "object", properties, line: tok.line, hash: `obj@${tok.line}` };
  }

  function parseProperty(): { key: string; value: Expr } {
    const key = expect(TokenKind.Ident, "Expected property name").value;
    if (!at(TokenKind.Colon)) {
      return { key, value: { kind: "ident", name: key, line: peek().line } };
    }
    expect(TokenKind.Colon);
    const value = parseExpr();
    return { key, value };
  }

  function isArrowParams(): boolean {
    let j = pos + 1;
    if (tokens[j]?.kind === TokenKind.RParen && tokens[j + 1]?.kind === TokenKind.Arrow) return true;
    while (j < tokens.length) {
      if (tokens[j]?.kind !== TokenKind.Ident) return false;
      j++;
      if (tokens[j]?.kind === TokenKind.RParen) {
        return tokens[j + 1]?.kind === TokenKind.Arrow;
      }
      if (tokens[j]?.kind !== TokenKind.Comma) return false;
      j++;
    }
    return false;
  }

  function parseParams(): string[] {
    expect(TokenKind.LParen);
    const params: string[] = [];
    if (!at(TokenKind.RParen)) {
      params.push(expect(TokenKind.Ident, "Expected parameter name").value);
      while (eat(TokenKind.Comma)) {
        params.push(expect(TokenKind.Ident, "Expected parameter name").value);
      }
    }
    expect(TokenKind.RParen);
    return params;
  }

  return parseProgram();
}
