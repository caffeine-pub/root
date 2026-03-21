import ts from "typescript";

// Canonical representation of a type's structure, used for both
// type identity hashing and codegen.

export type TypeNode =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "bigint" }
  | { kind: "null" }
  | { kind: "undefined" }
  | { kind: "void" }
  | { kind: "stringLiteral"; value: string }
  | { kind: "numberLiteral"; value: number }
  | { kind: "booleanLiteral"; value: boolean }
  | { kind: "object"; properties: PropertyNode[] }
  | { kind: "array"; element: TypeNode }
  | { kind: "tuple"; elements: TupleElement[] }
  | { kind: "union"; members: TypeNode[] }
  | { kind: "intersection"; members: TypeNode[] }
  | { kind: "enum"; name: string; members: { name: string; value: string | number }[] }
  | { kind: "typeParameter"; name: string; constraint: TypeNode | null }
  | { kind: "indexSignature"; keyType: "string" | "number"; valueType: TypeNode }
  | { kind: "date" }
  | { kind: "map"; keyType: TypeNode; valueType: TypeNode }
  | { kind: "set"; elementType: TypeNode }
  | { kind: "ref"; name: string; typeArguments?: TypeNode[] }; // reference to a named type (for recursion)

export interface PropertyNode {
  name: string;
  type: TypeNode;
  optional: boolean;
}

export interface TupleElement {
  type: TypeNode;
  optional: boolean;
}

export interface TypeParam {
  name: string;
  constraint: TypeNode | null;
}

export interface HashTarget {
  name: string;
  node: TypeNode;
  typeParams: TypeParam[];
  composable: boolean;
  sourceFile: string;
}

/**
 * Walk a TypeScript program and extract all @hash-tagged type declarations.
 */
export function extractHashTargets(program: ts.Program): HashTarget[] {
  const checker = program.getTypeChecker();
  const targets: HashTarget[] = [];
  const cache = new Map<number, TypeNode>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;

    ts.forEachChild(sourceFile, function visit(node) {
      if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node)
      ) {
        const hashInfo = getHashTag(node);
        if (hashInfo.tagged) {
          const name = node.name?.getText(sourceFile);
          if (!name) return;

          const symbol = checker.getSymbolAtLocation(node.name!);
          if (!symbol) return;

          const type = checker.getDeclaredTypeOfSymbol(symbol);
          const walked = walkType(checker, type, new Set(), cache);

          // Extract type parameters from the declaration
          const typeParams: TypeParam[] = [];
          if (
            (ts.isInterfaceDeclaration(node) ||
              ts.isTypeAliasDeclaration(node) ||
              ts.isClassDeclaration(node)) &&
            node.typeParameters
          ) {
            for (const tp of node.typeParameters) {
              const tpSymbol = checker.getSymbolAtLocation(tp.name);
              const tpType = tpSymbol
                ? checker.getDeclaredTypeOfSymbol(tpSymbol)
                : undefined;
              const constraint = tpType
                ? checker.getBaseConstraintOfType(tpType)
                : undefined;
              typeParams.push({
                name: tp.name.text,
                constraint: constraint
                  ? walkType(checker, constraint, new Set(), cache)
                  : null,
              });
            }
          }

          targets.push({
            name,
            node: walked,
            typeParams,
            composable: hashInfo.composable,
            sourceFile: sourceFile.fileName,
          });
        }
      }

      ts.forEachChild(node, visit);
    });
  }

  return targets;
}

function getHashTag(node: ts.Node): { tagged: boolean; composable: boolean } {
  const tags = ts.getJSDocTags(node);
  const hashTag = tags.find((tag) => tag.tagName.text === "hash");
  if (!hashTag) return { tagged: false, composable: false };
  const comment = typeof hashTag.comment === "string" ? hashTag.comment : "";
  return { tagged: true, composable: comment.includes("composable") };
}

/**
 * Walk a ts.Type and produce a canonical TypeNode.
 * `seen` tracks type IDs to detect recursive types.
 */
function walkType(
  checker: ts.TypeChecker,
  type: ts.Type,
  seen: Set<number>,
  cache: Map<number, TypeNode>,
): TypeNode {
  const typeId = (type as any).id as number;

  // Memoization fast path: if we've already fully walked this type, reuse it
  const cached = cache.get(typeId);
  if (cached) return cached;

  // Primitive flags
  if (type.flags & ts.TypeFlags.String) return { kind: "string" };
  if (type.flags & ts.TypeFlags.Number) return { kind: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { kind: "boolean" };
  if (type.flags & ts.TypeFlags.BigInt) return { kind: "bigint" };
  if (type.flags & ts.TypeFlags.Null) return { kind: "null" };
  if (type.flags & ts.TypeFlags.Undefined) return { kind: "undefined" };
  if (type.flags & ts.TypeFlags.Void) return { kind: "void" };

  // Literal types
  if (type.isStringLiteral()) return { kind: "stringLiteral", value: type.value };
  if (type.isNumberLiteral()) return { kind: "numberLiteral", value: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    // TS represents true/false as separate types in the checker
    const intrinsicName = (type as any).intrinsicName as string;
    return { kind: "booleanLiteral", value: intrinsicName === "true" };
  }

  // Union (including boolean which is true | false)
  if (type.isUnion()) {
    const members = type.types.map((t) => walkType(checker, t, seen, cache));
    // sort for canonical ordering
    members.sort(compareTypeNodes);
    return { kind: "union", members };
  }

  // Intersection
  if (type.isIntersection()) {
    const members = type.types.map((t) => walkType(checker, t, seen, cache));

    // If all members are objects, flatten into a single object with deduped properties
    if (members.every((m) => m.kind === "object")) {
      const propMap = new Map<string, PropertyNode>();
      for (const member of members) {
        if (member.kind === "object") {
          for (const prop of member.properties) {
            propMap.set(prop.name, prop); // later wins for overlaps
          }
        }
      }
      const properties = [...propMap.values()].sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      const result: TypeNode = { kind: "object", properties };
      seen.delete(typeId);
      cache.set(typeId, result);
      return result;
    }

    members.sort(compareTypeNodes);
    return { kind: "intersection", members };
  }

  // Type parameter (generic T)
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const symbol = type.getSymbol();
    const name = symbol ? symbol.getName() : "T";
    const constraint = checker.getBaseConstraintOfType(type);
    return {
      kind: "typeParameter",
      name,
      constraint: constraint ? walkType(checker, constraint, seen, cache) : null,
    };
  }

  // Object types (interfaces, classes, arrays, tuples, anonymous)
  if (type.flags & ts.TypeFlags.Object) {
    const objType = type as ts.ObjectType;

    // Recursion guard
    if (seen.has(typeId)) {
      // Prefer aliasSymbol (preserves the original type alias name even for
      // instantiated generics like LinkedList<string>), fall back to the
      // object type's own symbol (often __type for anonymous objects).
      const name = type.aliasSymbol?.getName()
        ?? type.getSymbol()?.getName()
        ?? `<recursive:${typeId}>`;
      // Extract instantiated type arguments (e.g. LinkedList<string> → [string])
      // so codegen can emit the correct concrete type, not the parametric one.
      const aliasArgs = type.aliasTypeArguments;
      const typeArguments = aliasArgs?.length
        ? aliasArgs.map((a) => walkType(checker, a, new Set(), cache))
        : undefined;
      return { kind: "ref", name, typeArguments };
    }
    seen.add(typeId);

    // Built-in types: Date, Map, Set
    const typeName = type.getSymbol()?.getName();
    if (typeName === "Date") {
      seen.delete(typeId);
      const result: TypeNode = { kind: "date" };
      cache.set(typeId, result);
      return result;
    }
    if (typeName === "Map") {
      const typeRef = type as ts.TypeReference;
      const typeArgs = checker.getTypeArguments(typeRef);
      const result: TypeNode = {
        kind: "map",
        keyType: typeArgs[0] ? walkType(checker, typeArgs[0], seen, cache) : { kind: "string" },
        valueType: typeArgs[1] ? walkType(checker, typeArgs[1], seen, cache) : { kind: "string" },
      };
      seen.delete(typeId);
      cache.set(typeId, result);
      return result;
    }
    if (typeName === "Set") {
      const typeRef = type as ts.TypeReference;
      const typeArgs = checker.getTypeArguments(typeRef);
      const result: TypeNode = {
        kind: "set",
        elementType: typeArgs[0] ? walkType(checker, typeArgs[0], seen, cache) : { kind: "string" },
      };
      seen.delete(typeId);
      cache.set(typeId, result);
      return result;
    }

    // Array
    if (checker.isArrayType(type)) {
      const typeRef = type as ts.TypeReference;
      const elementType = checker.getTypeArguments(typeRef)[0];
      const result: TypeNode = {
        kind: "array",
        element: walkType(checker, elementType, seen, cache),
      };
      seen.delete(typeId);
      cache.set(typeId, result);
      return result;
    }

    // Tuple
    if (checker.isTupleType(type)) {
      const typeRef = type as ts.TypeReference;
      const elementTypes = checker.getTypeArguments(typeRef);
      const target = typeRef.target as ts.TupleType;
      const elements: TupleElement[] = elementTypes.map((t, i) => ({
        type: walkType(checker, t, seen, cache),
        optional: target.elementFlags?.[i]
          ? (target.elementFlags[i] & ts.ElementFlags.Optional) !== 0
          : false,
      }));
      seen.delete(typeId);
      const tupleResult: TypeNode = { kind: "tuple", elements };
      cache.set(typeId, tupleResult);
      return tupleResult;
    }

    // Index signatures — check before regular properties
    const stringIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    const numberIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.Number);

    // If the type is purely an index signature with no named properties, emit indexSignature
    const properties = checker.getPropertiesOfType(type);
    const namedProps = properties.filter(
      (p) => !(p.flags & ts.SymbolFlags.Prototype),
    );

    if (namedProps.length === 0 && (stringIndexType || numberIndexType)) {
      // Pure index signature: { [key: string]: V } or { [key: number]: V }
      const keyType = stringIndexType ? "string" as const : "number" as const;
      const valType = (stringIndexType ?? numberIndexType)!;
      const result: TypeNode = {
        kind: "indexSignature",
        keyType,
        valueType: walkType(checker, valType, seen, cache),
      };
      seen.delete(typeId);
      cache.set(typeId, result);
      return result;
    }

    // Object with properties (interface, class, anonymous object type)
    // If there's an index signature, filter out named props whose key is
    // assignable to the index signature's key type — they'll be covered
    // by the dynamic iteration and don't need separate static hashing.
    // For [key: string]: all named props are string-keyed, so all get absorbed.
    // For [key: number]: named props are string-keyed, so none get absorbed
    //   (unless the name is numeric, checked via isTypeAssignableTo).
    const filteredProps = namedProps.filter((prop) => {
      if (stringIndexType) {
        // String index sig covers ALL string-keyed properties
        return false;
      }
      if (numberIndexType) {
        // Number index sig — absorb if the prop name is numeric
        const name = prop.getName();
        if (String(Number(name)) === name) {
          return false;
        }
      }
      return true;
    });

    // After filtering, if no named props remain, emit pure indexSignature
    if (filteredProps.length === 0 && (stringIndexType || numberIndexType)) {
      const keyType = stringIndexType ? "string" as const : "number" as const;
      const valType = (stringIndexType ?? numberIndexType)!;
      const result: TypeNode = {
        kind: "indexSignature",
        keyType,
        valueType: walkType(checker, valType, seen, cache),
      };
      seen.delete(typeId);
      cache.set(typeId, result);
      return result;
    }

    const props: PropertyNode[] = filteredProps
      .map((prop) => ({
        name: prop.getName(),
        type: walkType(checker, checker.getTypeOfSymbol(prop), seen, cache),
        optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    // If there's also an index signature alongside named properties,
    // attach it as a special property so codegen knows about it
    if (stringIndexType) {
      props.push({
        name: "[string]",
        type: { kind: "indexSignature", keyType: "string", valueType: walkType(checker, stringIndexType, seen, cache) },
        optional: false,
      });
    }
    if (numberIndexType) {
      props.push({
        name: "[number]",
        type: { kind: "indexSignature", keyType: "number", valueType: walkType(checker, numberIndexType, seen, cache) },
        optional: false,
      });
    }

    seen.delete(typeId);
    const objResult: TypeNode = { kind: "object", properties: props };
    cache.set(typeId, objResult);
    return objResult;
  }

  // Enum
  if (type.flags & ts.TypeFlags.Enum || type.flags & ts.TypeFlags.EnumLiteral) {
    const symbol = type.getSymbol();
    if (symbol) {
      const name = symbol.getName();
      const members: { name: string; value: string | number }[] = [];
      if (symbol.exports) {
        symbol.exports.forEach((memberSymbol) => {
          const memberType = checker.getTypeOfSymbol(memberSymbol);
          let value: string | number;
          if (memberType.isStringLiteral()) {
            value = memberType.value;
          } else if (memberType.isNumberLiteral()) {
            value = memberType.value;
          } else {
            value = memberSymbol.getName();
          }
          members.push({ name: memberSymbol.getName(), value });
        });
      }
      members.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { kind: "enum", name, members };
    }
  }

  // Fallback: treat as opaque ref
  const symbol = type.getSymbol();
  return { kind: "ref", name: symbol?.getName() ?? checker.typeToString(type) };
}

/**
 * Compare TypeNodes for canonical ordering in unions/intersections.
 * Sort by kind first, then by distinguishing fields.
 */
function compareTypeNodes(a: TypeNode, b: TypeNode): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;

  switch (a.kind) {
    case "stringLiteral":
      return a.value < (b as typeof a).value ? -1 : a.value > (b as typeof a).value ? 1 : 0;
    case "numberLiteral":
      return a.value - (b as typeof a).value;
    case "booleanLiteral":
      return a.value === (b as typeof a).value ? 0 : a.value ? 1 : -1;
    case "ref":
      return a.name < (b as typeof a).name ? -1 : a.name > (b as typeof a).name ? 1 : 0;
    default:
      return 0;
  }
}
