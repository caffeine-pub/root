# TypeScript Compiler API Surface for ts-hash

## Overview

ts-hash needs to: take a type annotation → walk its structure → generate a specialized hash function. Here's every compiler API we'll need, grouped by phase.

---

## Phase 1: Program Creation & Setup

```ts
import ts from "typescript";

// Create a program from tsconfig or files
const program = ts.createProgram(fileNames, compilerOptions);
// or from a tsconfig:
const configFile = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath);
const program = ts.createProgram(parsed.fileNames, parsed.options);

// Get the type checker — this is our main entry point
const checker = program.getTypeChecker();

// Get source files
const sourceFile = program.getSourceFile("src/types.ts");
```

**Key types:** `ts.Program`, `ts.TypeChecker`, `ts.SourceFile`

---

## Phase 2: Finding Types to Hash

We need to find type declarations marked for hashing (e.g., via a marker type, decorator, or explicit API call).

```ts
// Walk AST nodes in a source file
ts.forEachChild(sourceFile, function visit(node) {
  // Check if it's an interface declaration
  if (ts.isInterfaceDeclaration(node)) {
    const symbol = checker.getSymbolAtLocation(node.name);
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    // ... process
  }

  // Check if it's a type alias
  if (ts.isTypeAliasDeclaration(node)) {
    const symbol = checker.getSymbolAtLocation(node.name);
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    // ... process
  }

  ts.forEachChild(node, visit);
});
```

**AST node guards we'll use:**
- `ts.isInterfaceDeclaration(node)`
- `ts.isTypeAliasDeclaration(node)`
- `ts.isClassDeclaration(node)`
- `ts.isEnumDeclaration(node)`
- `ts.isPropertySignature(node)`
- `ts.isTypeReferenceNode(node)`
- `ts.isUnionTypeNode(node)`
- `ts.isIntersectionTypeNode(node)`
- `ts.isArrayTypeNode(node)`
- `ts.isTupleTypeNode(node)`
- `ts.isLiteralTypeNode(node)`
- `ts.isTypeLiteralNode(node)` (anonymous object types like `{ x: number }`)

---

## Phase 3: Type Walking (the core)

This is where we recursively decompose a type into its hashable structure.

### 3a. Type Flags (what kind of type is this?)

```ts
type.flags & ts.TypeFlags.String      // string
type.flags & ts.TypeFlags.Number      // number
type.flags & ts.TypeFlags.Boolean     // boolean
type.flags & ts.TypeFlags.BigInt      // bigint
type.flags & ts.TypeFlags.Null        // null
type.flags & ts.TypeFlags.Undefined   // undefined
type.flags & ts.TypeFlags.Void        // void
type.flags & ts.TypeFlags.Never       // never
type.flags & ts.TypeFlags.StringLiteral   // "hello"
type.flags & ts.TypeFlags.NumberLiteral   // 42
type.flags & ts.TypeFlags.BooleanLiteral  // true / false
type.flags & ts.TypeFlags.EnumLiteral     // enum member
type.flags & ts.TypeFlags.Union       // A | B
type.flags & ts.TypeFlags.Intersection // A & B
type.flags & ts.TypeFlags.Object      // interfaces, classes, object literals, arrays, tuples
type.flags & ts.TypeFlags.TypeParameter // generic T
```

### 3b. Object Types (interfaces, classes, arrays, tuples)

```ts
// Check object type sub-kinds via objectFlags
if (type.flags & ts.TypeFlags.Object) {
  const objType = type as ts.ObjectType;

  objType.objectFlags & ts.ObjectFlags.Interface    // interface Foo { ... }
  objType.objectFlags & ts.ObjectFlags.Reference    // Foo<T>, Array<T>, [T, U]
  objType.objectFlags & ts.ObjectFlags.Anonymous    // { x: number }
  objType.objectFlags & ts.ObjectFlags.Tuple        // [string, number]
  objType.objectFlags & ts.ObjectFlags.ClassOrInterface
}

// Get properties of an object type (fields of an interface/class)
const properties: ts.Symbol[] = checker.getPropertiesOfType(type);
// or for apparent properties (includes inherited):
const apparent: ts.Symbol[] = checker.getAugmentedPropertiesOfType(type);

// For each property, get its type:
for (const prop of properties) {
  const propType = checker.getTypeOfSymbol(prop);
  const propName = prop.getName();
  const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
  // recurse into propType...
}
```

### 3c. Arrays and Tuples

```ts
// Check if a type is an array
if (checker.isArrayType(type)) {
  const typeRef = type as ts.TypeReference;
  const elementType = checker.getTypeArguments(typeRef)[0];
  // hash = hashArray(elementType)
}

// Check if it's a tuple
if (checker.isTupleType(type)) {
  const typeRef = type as ts.TypeReference;
  const elementTypes = checker.getTypeArguments(typeRef);
  // hash each element type in order
}
```

### 3d. Unions and Intersections

```ts
if (type.isUnion()) {
  const members = type.types; // ts.Type[]
  // need a discriminant or tag to know which variant we have at runtime
  // this is where it gets interesting for codegen
}

if (type.isIntersection()) {
  const members = type.types;
  // merge all properties from all members
}
```

### 3e. Generics / Type Parameters

```ts
// Check if it's a generic type reference like Foo<T>
if ((type as ts.TypeReference).typeArguments) {
  const typeArgs = checker.getTypeArguments(type as ts.TypeReference);
  const target = (type as ts.TypeReference).target; // the uninstantiated Foo<>
}

// Check if it's a type parameter itself (the T in Foo<T>)
if (type.flags & ts.TypeFlags.TypeParameter) {
  const constraint = checker.getBaseConstraintOfType(type);
  // for codegen: this becomes a generic parameter in the generated hash fn
}
```

### 3f. Literal Types

```ts
if (type.isStringLiteral()) {
  type.value; // the actual string, e.g. "hello"
}
if (type.isNumberLiteral()) {
  type.value; // the actual number, e.g. 42
}
```

### 3g. Built-in Collection Types (Date, Map, Set)

```ts
// Detect by symbol name on the type
const typeName = type.getSymbol()?.getName();

if (typeName === "Date") {
  // No type arguments needed — just hash getTime()
}

if (typeName === "Map" || typeName === "Set") {
  // Extract type arguments for key/value/element types
  const typeRef = type as ts.TypeReference;
  const typeArgs = checker.getTypeArguments(typeRef);
  // Map: typeArgs[0] = key type, typeArgs[1] = value type
  // Set: typeArgs[0] = element type
}
```

These are checked before the general object property walking. Without this, `Map<string, number>` would be decomposed into its full interface (with `get`, `set`, `forEach`, `size`, etc.) — not useful for hashing.

### 3h. Enum Types

```ts
// Get enum members
if (type.flags & ts.TypeFlags.Enum || type.flags & ts.TypeFlags.EnumLiteral) {
  const symbol = type.getSymbol();
  // walk enum members via symbol.exports or checker.getPropertiesOfType
}
```

---

## Phase 4: Type Identity & Normalization

We need to detect when two types are the same (for caching generated hash functions) and detect cycles.

```ts
// Unique type identity — use the type's id (internal but stable within a program)
(type as any).id; // number, internal property

// Type-to-string for debugging
checker.typeToString(type);
checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);

// Check structural compatibility
checker.isTypeAssignableTo(typeA, typeB);

// Resolve type aliases to their underlying type
const resolved = checker.getBaseTypeOfLiteralType(type);

// For type aliases specifically:
if (type.aliasSymbol) {
  type.aliasSymbol;        // the alias symbol
  type.aliasTypeArguments;  // type args if generic alias
}
```

---

## Phase 5: Cycle Detection

```ts
// We need to detect recursive types at compile time and reject them.
// Strategy: maintain a Set<number> of type IDs currently being walked.
// If we see a type ID we're already processing, it's recursive.
//
// (type as any).id gives us the internal ID.
// This is technically internal API but it's stable and everyone uses it.
```

---

## Phase 6: Code Generation

Not a compiler API question — this is our output. But the compiler API helps with:

```ts
// Create a printer for emitting generated TS code
const printer = ts.createPrinter({ newLine: ts.NewLineFeed });

// Create AST nodes programmatically (factory API)
ts.factory.createFunctionDeclaration(/* ... */);
ts.factory.createBlock(/* ... */);
ts.factory.createReturnStatement(/* ... */);
// etc.

// Or just emit strings directly (simpler for codegen)
```

---

## Summary: The Critical Path

1. `ts.createProgram` → `program.getTypeChecker()` — setup
2. `ts.forEachChild` + node guards — find types to hash
3. `checker.getPropertiesOfType` — get struct fields
4. `type.flags` + `TypeFlags` — classify what we're looking at
5. `checker.getTypeArguments` — unwrap generics, arrays, tuples
6. `type.isUnion()` / `type.isIntersection()` — decompose composites
7. `checker.getTypeOfSymbol` — get type of each field
8. `(type as any).id` — identity/cycle detection

These are all stable APIs that have existed since TS 2.x. The tsgo port will need to expose equivalent functionality over IPC — they've committed to supporting programmatic type queries, so this surface should translate.
