# Type Walker

The walker (`src/walker.ts`) is the first phase of ts-hash. It reads a TypeScript program, finds types tagged with `/** @hash */`, and produces a canonical intermediate representation of their structure — a `TypeNode` tree. This tree is the input to codegen.

## Usage

Tag any interface, type alias, or class with `/** @hash */`:

```ts
/** @hash */
interface User {
  name: string;
  age: number;
  email: string;
}
```

Then call `extractHashTargets` with a `ts.Program`:

```ts
import ts from "typescript";
import { extractHashTargets } from "./walker.js";

const program = ts.createProgram(["src/types.ts"], { /* compilerOptions */ });
const targets = extractHashTargets(program);
// targets: [{ name: "User", node: TypeNode, sourceFile: "src/types.ts" }]
```

Untagged types are ignored. The walker only processes user source files, not declaration files.

## TypeNode IR

The walker produces a tree of `TypeNode` values. Each node has a `kind` discriminant:

### Primitives

`string`, `number`, `boolean`, `bigint`, `null`, `undefined`, `void` — leaf nodes, no additional data.

### Literals

- `stringLiteral` — carries `value: string` (e.g., `"active"`)
- `numberLiteral` — carries `value: number` (e.g., `42`)
- `booleanLiteral` — carries `value: boolean` (e.g., `true`)

### Objects

`object` — carries `properties: PropertyNode[]`, where each `PropertyNode` has:
- `name: string` — the property key
- `type: TypeNode` — the property's type, recursively walked
- `optional: boolean` — whether the property is optional (`?`)

Properties are **sorted alphabetically by name**. This is critical: `{ b: number, a: string }` and `{ a: string, b: number }` produce identical TypeNode trees. The sort order is the canonical field order for hashing values.

Nested object types are fully inlined. If `Nested` has a field `point: Point`, the walker expands `Point`'s full structure into the tree rather than emitting a reference. This means two `@hash` types sharing a sub-type will duplicate the structure, but that's correct for codegen — each generated hash function is self-contained.

### Arrays

`array` — carries `element: TypeNode`. The element type is recursively walked.

### Tuples

`tuple` — carries `elements: TupleElement[]`, where each element has:
- `type: TypeNode`
- `optional: boolean`

Tuple elements preserve their declaration order (not sorted — position matters).

### Unions

`union` — carries `members: TypeNode[]`. Members are **sorted canonically** by kind, then by distinguishing fields within each kind (alphabetical for string literals, numeric for number literals, etc.). This means `string | number` and `number | string` produce identical trees.

TypeScript represents `boolean` as `true | false` internally. The walker checks `TypeFlags.Boolean` before checking for unions, so `boolean` stays as a single `boolean` node rather than being decomposed.

### Built-in Collection Types

Three built-in types are recognized by symbol name and given dedicated node kinds:

- `date` — no additional data. Represents `Date`.
- `map` — carries `keyType: TypeNode` and `valueType: TypeNode`. Represents `Map<K, V>`.
- `set` — carries `elementType: TypeNode`. Represents `Set<T>`.

These are detected before the general object property walking, so `Map<string, number>` becomes `{ kind: "map", keyType: string, valueType: number }` rather than being decomposed into its interface properties (which would include `get`, `set`, `forEach`, etc. — not what you want to hash).

Type arguments are extracted from the type reference. If a `Map` or `Set` has no explicit type arguments (shouldn't happen in practice for `@hash` types), the walker defaults to `string`.

### Intersections

`intersection` — carries `members: TypeNode[]`, sorted the same way as unions.

When all members of an intersection are object types, the walker flattens them into a single `object` node with deduplicated properties. Later properties win for overlaps — so `User & { id: string; extra: number }` where `User` already has `id: string` produces a single object node with `id` appearing once. This prevents fields from being hashed twice in the generated code.

If any member is non-object (e.g., `string & Brand`), the intersection is preserved as-is with sorted members.

### Enums

`enum` — carries `name: string` and `members: { name: string, value: string | number }[]`. Members are sorted alphabetically by name.

### Type Parameters

`typeParameter` — carries `name: string` and `constraint: TypeNode | null`. These appear when walking generic types. The constraint, if present, is recursively walked.

### Refs

`ref` — carries `name: string`. Used in two cases:

1. **Recursive types.** When the walker encounters a type it's already walking (detected via TypeScript's internal type ID), it emits a `ref` instead of recursing infinitely. For example, `Recursive { value: number, children: Recursive[] }` produces an `array` node whose element is `ref("Recursive")`.

2. **Opaque types.** If the walker encounters a type it can't decompose (shouldn't happen for well-typed code), it falls back to a `ref` with the type's string representation.

## Memoization

The walker maintains a `Map<number, TypeNode>` cache keyed by TypeScript's internal type ID. After fully walking a type (object, array, or tuple), the result is cached. Subsequent encounters of the same type return the cached `TypeNode` without re-walking. This is a fast path for types that appear in multiple positions — if `Point` is used in 5 different `@hash`-tagged types, its structure is only walked once.

The cache is created once per `extractHashTargets` call and shared across all `@hash` types in the program. If `Point` appears in both `UserLocation` and `MapMarker`, it's walked once. Primitives, literals, and unions/intersections are cheap enough not to cache.

## Recursion Detection

The walker maintains a separate `Set<number>` of TypeScript internal type IDs currently being walked. When entering an object type, it checks if the ID is already in the set. If so, it emits a `ref` node. The ID is removed from the set after the type's properties have been fully walked, so the same type appearing in sibling positions (non-recursive) is expanded normally.

The memoization cache and recursion set interact correctly: the cache check happens first, so a previously-completed type is returned from cache before the recursion set is consulted. A type only hits the recursion set if it's being walked *right now* in the current call stack.

This means: a type that appears twice in a struct (e.g., `{ a: Point, b: Point }`) gets walked once and cached, then the second occurrence hits the cache. A type that appears in its own definition (e.g., `{ children: Recursive[] }`) gets a `ref` on the recursive occurrence because the cache isn't populated until the walk completes.

## Canonical Ordering

Two invariants ensure that structurally equivalent types produce identical TypeNode trees:

1. **Object properties are sorted alphabetically by name.** Declaration order is irrelevant.
2. **Union and intersection members are sorted by kind, then by value.** The sort is: kind string compared lexicographically, then within the same kind: string literals alphabetically, number literals numerically, boolean literals (false before true), refs alphabetically.

This means the walker's output is a canonical representative of the type's structural equivalence class. Two types with the same structure always produce the same tree, regardless of source-level ordering.

## JSDoc Tag Detection

The walker uses `ts.getJSDocTags(node)` to find `@hash` tags. This requires the tag to be in a JSDoc comment (`/** ... */`), not a regular comment (`// ...`). The check is simple: any JSDoc tag whose `tagName.text` is `"hash"` triggers extraction.

## Generics

The walker extracts type parameters from generic `@hash` declarations. Each `HashTarget` carries a `typeParams` array:

```ts
interface TypeParam {
  name: string;
  constraint: TypeNode | null;
}
```

For `/** @hash */ interface Box<T> { value: T }`, the target has `typeParams: [{ name: "T", constraint: null }]`. The `value` field in the TypeNode tree is `{ kind: "typeParameter", name: "T", constraint: null }`.

For constrained generics like `interface Constrained<T extends { hash(h: any): void }>`, the constraint is walked into a TypeNode. The constraint `{ hash(h: any): void }` becomes an object type with a `hash` property.

Non-generic types have `typeParams: []`.

### How generics affect codegen

The codegen restriction for generics: type parameters that appear in hashable positions must have a `.hash(h: Hasher)` method. The generated hash function for `Box<T>` calls `value.value.hash(h)` at type parameter positions. The user is responsible for adding `.hash()` to their concrete types — typically by wrapping the generated standalone hash function:

```ts
class MyType {
  hash(h: Hasher) { hashMyType(h, this); }
}
```

This avoids dictionary-passing and monomorphization. It's a rare enough case that manual wiring is acceptable.

## Index Signatures

The walker handles index signatures (`{ [key: string]: V }` and `{ [key: number]: V }`).

**Pure index signatures** — types with no named properties — are emitted as a single `indexSignature` node:

```ts
/** @hash */
interface StringMap {
  [key: string]: number;
}
// → { kind: "indexSignature", keyType: "string", valueType: { kind: "number" } }
```

**Mixed types** — named properties alongside an index signature — are emitted as an `object` node with an extra pseudo-property named `[string]` or `[number]`:

```ts
/** @hash */
interface MixedIndex {
  name: string;
  [key: string]: string | number;
}
// → { kind: "object", properties: [
//      { name: "name", type: { kind: "string" }, optional: false },
//      { name: "[string]", type: { kind: "indexSignature", ... }, optional: false }
//    ] }
```

Index signatures result in runtime key enumeration during hashing — `Object.keys(value).sort()` — which is fundamentally slower than the static field access path for known properties. This is an unavoidable consequence of keys not being known at compile time.

## What's Not Handled

- **Conditional types** (`T extends U ? A : B`) — would need evaluation.
- **Function types** (`(x: number) => string`) — not hashable in the general case.
- **`never`** — filtered out of unions by TypeScript before we see them, but not explicitly represented.
- **Other built-in object types** — `RegExp`, `Error`, `Promise`, `WeakMap`, `WeakSet`, etc. are not given special treatment. They'd be walked as regular objects (exposing their interface methods), which isn't useful for hashing. Add dedicated node kinds as needed.

These can be added if needed. The current coverage handles the common cases for data types you'd want to hash: records, arrays, tuples, unions, intersections, index signatures, Date, Map, Set, enums, generics, and primitives.
