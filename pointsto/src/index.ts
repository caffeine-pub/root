export { lex, TokenKind } from "./lexer.js";
export type { Token } from "./lexer.js";
export { parse } from "./parser.js";
export type * from "./ast.js";
export { analyze } from "./analysis.js";

import { parse } from "./parser.js";
import { analyze } from "./analysis.js";
import { Place, PossibleValues } from "./kleene.js";
import { lex } from "./lexer.js";

if (process.env.DEBUG) {
  const result = analyze(
    parse(
      lex(`
    let a = (x) => {
      return b(x);
    };
    let b = (y) => {
      return y();
    };
    let target = {};
    let result = a(() => { return target; });
  `),
    ),
  );

  for (const [place, values] of result) {
    const objs = [...values.objects].map((o) => o.name);
    const fns = [...values.functions].map((f) => f.hash);
    const all = [...objs, ...fns];
    if (all.length > 0) {
      console.log(`${place.name} → ${all.join(", ")}`);
    }
  }
}
