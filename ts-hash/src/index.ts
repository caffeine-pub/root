// Runtime exports — used by generated hash.gen.ts files
export { Hasher } from "./hasher.js";
export { SipHash } from "./siphash.js";

// API exports — used by the CLI and programmatic consumers
export { extractHashTargets } from "./walker.js";
export type { HashTarget, TypeNode, PropertyNode, TupleElement, TypeParam } from "./walker.js";
export { generateHashFile } from "./codegen.js";
