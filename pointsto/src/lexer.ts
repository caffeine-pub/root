export enum TokenKind {
  // Literals & identifiers
  Ident,
  Number,
  String,
  True,
  False,
  Null,

  // Keywords
  Let,
  If,
  Else,
  Loop,
  Break,
  Return,

  // Punctuation
  LParen,    // (
  RParen,    // )
  LBrace,    // {
  RBrace,    // }
  LBracket,  // [
  RBracket,  // ]
  Comma,     // ,
  Dot,       // .
  Semicolon, // ;
  Colon,     // :

  // Operators
  Eq,        // =
  Arrow,     // =>
  EqEq,      // ==
  BangEq,    // !=
  Lt,        // <
  Gt,        // >
  LtEq,     // <=
  GtEq,     // >=
  Plus,      // +
  Minus,     // -
  Star,      // *
  Slash,     // /
  Bang,      // !
  And,       // &&
  Or,        // ||

  // Special
  EOF,
}

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

const KEYWORDS: Record<string, TokenKind> = {
  let: TokenKind.Let,
  if: TokenKind.If,
  else: TokenKind.Else,
  loop: TokenKind.Loop,
  break: TokenKind.Break,
  return: TokenKind.Return,
  true: TokenKind.True,
  false: TokenKind.False,
  null: TokenKind.Null,
};

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function peek(): string {
    return source[i] ?? "\0";
  }

  function advance(): string {
    const ch = source[i++];
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function emit(kind: TokenKind, value: string, startLine: number, startCol: number) {
    tokens.push({ kind, value, line: startLine, col: startCol });
  }

  while (i < source.length) {
    const startLine = line;
    const startCol = col;
    const ch = peek();

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Line comments
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && peek() !== "\n") advance();
      continue;
    }

    // Block comments
    if (ch === "/" && source[i + 1] === "*") {
      advance(); advance();
      while (i < source.length && !(peek() === "*" && source[i + 1] === "/")) advance();
      if (i < source.length) { advance(); advance(); }
      continue;
    }

    // Identifiers and keywords
    if (isIdentStart(ch)) {
      let value = "";
      while (i < source.length && isIdentPart(peek())) {
        value += advance();
      }
      const keyword = KEYWORDS[value];
      emit(keyword ?? TokenKind.Ident, value, startLine, startCol);
      continue;
    }

    // Numbers
    if (isDigit(ch)) {
      let value = "";
      while (i < source.length && isDigit(peek())) {
        value += advance();
      }
      if (peek() === "." && isDigit(source[i + 1] ?? "")) {
        value += advance(); // .
        while (i < source.length && isDigit(peek())) {
          value += advance();
        }
      }
      emit(TokenKind.Number, value, startLine, startCol);
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = advance();
      let value = "";
      while (i < source.length && peek() !== quote) {
        if (peek() === "\\") {
          advance();
          const esc = advance();
          switch (esc) {
            case "n": value += "\n"; break;
            case "t": value += "\t"; break;
            case "\\": value += "\\"; break;
            default: value += esc; break;
          }
        } else {
          value += advance();
        }
      }
      if (i < source.length) advance(); // closing quote
      emit(TokenKind.String, value, startLine, startCol);
      continue;
    }

    // Two-character operators
    if (ch === "=" && source[i + 1] === ">") { advance(); advance(); emit(TokenKind.Arrow, "=>", startLine, startCol); continue; }
    if (ch === "=" && source[i + 1] === "=") { advance(); advance(); emit(TokenKind.EqEq, "==", startLine, startCol); continue; }
    if (ch === "!" && source[i + 1] === "=") { advance(); advance(); emit(TokenKind.BangEq, "!=", startLine, startCol); continue; }
    if (ch === "<" && source[i + 1] === "=") { advance(); advance(); emit(TokenKind.LtEq, "<=", startLine, startCol); continue; }
    if (ch === ">" && source[i + 1] === "=") { advance(); advance(); emit(TokenKind.GtEq, ">=", startLine, startCol); continue; }
    if (ch === "&" && source[i + 1] === "&") { advance(); advance(); emit(TokenKind.And, "&&", startLine, startCol); continue; }
    if (ch === "|" && source[i + 1] === "|") { advance(); advance(); emit(TokenKind.Or, "||", startLine, startCol); continue; }

    // Single-character tokens
    const SINGLE: Record<string, TokenKind> = {
      "(": TokenKind.LParen,
      ")": TokenKind.RParen,
      "{": TokenKind.LBrace,
      "}": TokenKind.RBrace,
      "[": TokenKind.LBracket,
      "]": TokenKind.RBracket,
      ",": TokenKind.Comma,
      ".": TokenKind.Dot,
      ";": TokenKind.Semicolon,
      ":": TokenKind.Colon,
      "=": TokenKind.Eq,
      "<": TokenKind.Lt,
      ">": TokenKind.Gt,
      "+": TokenKind.Plus,
      "-": TokenKind.Minus,
      "*": TokenKind.Star,
      "/": TokenKind.Slash,
      "!": TokenKind.Bang,
    };

    const single = SINGLE[ch];
    if (single !== undefined) {
      advance();
      emit(single, ch, startLine, startCol);
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at ${startLine}:${startCol}`);
  }

  emit(TokenKind.EOF, "", line, col);
  return tokens;
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}
