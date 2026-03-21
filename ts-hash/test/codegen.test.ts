import { describe, it, expect } from "vitest";
import { generateHashFile } from "../src/codegen.js";
import { HashTarget, TypeNode } from "../src/walker.js";

function target(
  name: string,
  node: TypeNode,
  opts: { composable?: boolean; typeParams?: { name: string; constraint: TypeNode | null }[] } = {},
): HashTarget {
  return {
    name,
    node,
    typeParams: opts.typeParams ?? [],
    composable: opts.composable ?? false,
    sourceFile: "test.ts",
  };
}

describe("codegen", () => {
  it("generates hash for simple object with primitives", () => {
    const t = target("Point", {
      kind: "object",
      properties: [
        { name: "x", type: { kind: "number" }, optional: false },
        { name: "y", type: { kind: "number" }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toMatchSnapshot();
    // Should NOT have _hashPoint since not composable
    expect(code).not.toContain("_hashPoint");
    expect(code).toContain("h.f64(value.x)");
    expect(code).toContain("h.f64(value.y)");
  });

  it("generates hash for object with string, number, boolean", () => {
    const t = target("User", {
      kind: "object",
      properties: [
        { name: "age", type: { kind: "number" }, optional: false },
        { name: "email", type: { kind: "string" }, optional: false },
        { name: "name", type: { kind: "string" }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("h.f64(value.age)");
    expect(code).toContain("h.str(value.email)");
    expect(code).toContain("h.str(value.name)");
  });

  it("generates hash for optional properties", () => {
    const t = target("WithOptional", {
      kind: "object",
      properties: [
        { name: "name", type: { kind: "string" }, optional: false },
        { name: "nickname", type: { kind: "string" }, optional: true },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("if (value.nickname !== undefined)");
    expect(code).toContain("h.u8(1)");
    expect(code).toContain("h.u8(0)");
    expect(code).toMatchSnapshot();
  });

  it("generates hash for arrays", () => {
    const t = target("WithArray", {
      kind: "object",
      properties: [
        {
          name: "items",
          type: { kind: "array", element: { kind: "string" } },
          optional: false,
        },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("h.u32(value.items.length)");
    expect(code).toContain("for (const _el of value.items)");
    expect(code).toContain("h.str(_el)");
  });

  it("generates hash for nested arrays without variable shadowing", () => {
    const t = target("Matrix", {
      kind: "object",
      properties: [
        {
          name: "data",
          type: {
            kind: "array",
            element: { kind: "array", element: { kind: "number" } },
          },
          optional: false,
        },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("for (const _el of value.data)");
    expect(code).toContain("for (const _el1 of _el)");
    expect(code).toContain("h.f64(_el1)");
    expect(code).toMatchSnapshot();
  });

  it("generates hash for tuples", () => {
    const t = target("Coord", {
      kind: "tuple",
      elements: [
        { type: { kind: "number" }, optional: false },
        { type: { kind: "number" }, optional: false },
        { type: { kind: "string" }, optional: true },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("h.f64(value[0])");
    expect(code).toContain("h.f64(value[1])");
    expect(code).toContain("if (value[2] !== undefined)");
    expect(code).toMatchSnapshot();
  });

  it("generates hash for nullable types", () => {
    const t = target("WithNull", {
      kind: "object",
      properties: [
        {
          name: "value",
          type: {
            kind: "union",
            members: [{ kind: "null" }, { kind: "string" }],
          },
          optional: false,
        },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("if (value.value !== null)");
    expect(code).toContain("h.u8(1)");
    expect(code).toContain("h.str(value.value)");
    expect(code).toMatchSnapshot();
  });

  it("generates hash for discriminated unions", () => {
    const t = target("Shape", {
      kind: "union",
      members: [
        {
          kind: "object",
          properties: [
            { name: "kind", type: { kind: "stringLiteral", value: "circle" }, optional: false },
            { name: "radius", type: { kind: "number" }, optional: false },
          ],
        },
        {
          kind: "object",
          properties: [
            { name: "kind", type: { kind: "stringLiteral", value: "rect" }, optional: false },
            { name: "width", type: { kind: "number" }, optional: false },
            { name: "height", type: { kind: "number" }, optional: false },
          ],
        },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain('value.kind === "circle"');
    expect(code).toContain('value.kind === "rect"');
    expect(code).toContain("h.f64(value.radius)");
    expect(code).toContain("h.f64(value.width)");
    expect(code).toMatchSnapshot();
  });

  it("generates hash for primitive unions via typeof", () => {
    const t = target("StringOrNumber", {
      kind: "union",
      members: [{ kind: "number" }, { kind: "string" }],
    });
    const code = generateHashFile([t]);
    expect(code).toContain('typeof value === "number"');
    expect(code).toContain('typeof value === "string"');
    expect(code).toMatchSnapshot();
  });

  it("generates hash for pure index signatures", () => {
    const t = target("StringMap", {
      kind: "indexSignature",
      keyType: "string",
      valueType: { kind: "number" },
    });
    const code = generateHashFile([t]);
    expect(code).toContain("Object.keys(value).sort()");
    expect(code).toContain("h.str(_k)");
    expect(code).toContain("h.f64(value[_k])");
    expect(code).toMatchSnapshot();
  });

  it("generates hash for mixed object + index signature (named props absorbed by walker)", () => {
    // When the walker sees a string index sig, it absorbs all named props.
    // So by the time codegen sees this, it's just an object with the index sig pseudo-prop.
    const t = target("MixedIndex", {
      kind: "object",
      properties: [
        {
          name: "[string]",
          type: {
            kind: "indexSignature",
            keyType: "string",
            valueType: {
              kind: "union",
              members: [{ kind: "number" }, { kind: "string" }],
            },
          },
          optional: false,
        },
      ],
    });
    const code = generateHashFile([t]);
    // No named prop — walker absorbed it
    expect(code).not.toContain("value.name");
    // Just the index signature iteration
    expect(code).toContain("Object.keys(value).sort()");
    expect(code).toMatchSnapshot();
  });

  it("generates composable version when explicitly marked", () => {
    const t = target(
      "Point",
      {
        kind: "object",
        properties: [
          { name: "x", type: { kind: "number" }, optional: false },
          { name: "y", type: { kind: "number" }, optional: false },
        ],
      },
      { composable: true },
    );
    const code = generateHashFile([t]);
    expect(code).toContain("export function _hashPoint(h: Hasher");
    expect(code).toContain("export function hashPoint(value:");
    // Public version should delegate to composable
    expect(code).toContain("_hashPoint(h, value)");
    expect(code).toMatchSnapshot();
  });

  it("generates composable version for recursive types", () => {
    const t = target("TreeNode", {
      kind: "object",
      properties: [
        {
          name: "children",
          type: { kind: "array", element: { kind: "ref", name: "TreeNode" } },
          optional: false,
        },
        { name: "value", type: { kind: "number" }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    // Should auto-detect ref and generate composable
    expect(code).toContain("export function _hashTreeNode(h: Hasher");
    expect(code).toContain("_hashTreeNode(h, _el)");
    expect(code).toMatchSnapshot();
  });

  it("generates generic hash function with type params", () => {
    const t = target(
      "Box",
      {
        kind: "object",
        properties: [
          { name: "value", type: { kind: "typeParameter", name: "T", constraint: null }, optional: false },
        ],
      },
      { typeParams: [{ name: "T", constraint: null }] },
    );
    const code = generateHashFile([t]);
    expect(code).toContain("function hashBox<T extends { hash(h: Hasher): void }>");
    expect(code).toContain("value.value.hash(h)");
    expect(code).toMatchSnapshot();
  });

  it("generates generic with existing constraint — intersects with hash", () => {
    const t = target(
      "Wrapper",
      {
        kind: "object",
        properties: [
          { name: "inner", type: { kind: "typeParameter", name: "T", constraint: null }, optional: false },
        ],
      },
      {
        typeParams: [{
          name: "T",
          constraint: {
            kind: "object",
            properties: [{ name: "id", type: { kind: "number" }, optional: false }],
          },
        }],
      },
    );
    const code = generateHashFile([t]);
    // Should intersect existing constraint with hash requirement
    expect(code).toContain("T extends { id: number } & { hash(h: Hasher): void }");
    expect(code).toMatchSnapshot();
  });

  it("preserves constraint on unused type param without adding hash", () => {
    // A type param that has a constraint but doesn't appear in hashable position
    // (contrived but tests the branch)
    const t = target(
      "Phantom",
      {
        kind: "object",
        properties: [
          { name: "value", type: { kind: "string" }, optional: false },
        ],
      },
      {
        typeParams: [{
          name: "T",
          constraint: {
            kind: "object",
            properties: [{ name: "id", type: { kind: "number" }, optional: false }],
          },
        }],
      },
    );
    const code = generateHashFile([t]);
    // T has a constraint but doesn't need hash — just keep original constraint
    expect(code).toContain("T extends { id: number }");
    expect(code).not.toContain("& { hash(h: Hasher): void }");
  });

  it("generates generic with multiple type params", () => {
    const t = target(
      "Pair",
      {
        kind: "object",
        properties: [
          { name: "first", type: { kind: "typeParameter", name: "A", constraint: null }, optional: false },
          { name: "second", type: { kind: "typeParameter", name: "B", constraint: null }, optional: false },
        ],
      },
      { typeParams: [{ name: "A", constraint: null }, { name: "B", constraint: null }] },
    );
    const code = generateHashFile([t]);
    expect(code).toContain("function hashPair<A extends { hash(h: Hasher): void }, B extends { hash(h: Hasher): void }>");
    expect(code).toContain("value.first.hash(h)");
    expect(code).toContain("value.second.hash(h)");
  });

  it("generates hash for bigint", () => {
    const t = target("WithBigInt", {
      kind: "object",
      properties: [
        { name: "id", type: { kind: "bigint" }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("h.bigint(value.id)");
  });

  it("generates hash for boolean fields", () => {
    const t = target("Flags", {
      kind: "object",
      properties: [
        { name: "active", type: { kind: "boolean" }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("h.bool(value.active)");
  });

  it("generates hash for enum types", () => {
    const t = target("WithEnum", {
      kind: "object",
      properties: [
        {
          name: "status",
          type: { kind: "enum", name: "Status", members: [{ name: "Active", value: "active" }, { name: "Inactive", value: "inactive" }] },
          optional: false,
        },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain('typeof value.status === "string"');
    expect(code).toContain("h.str(value.status)");
    expect(code).toMatchSnapshot();
  });

  it("emits enum as literal union in type annotation (string enum)", () => {
    const t = target("WithEnum", {
      kind: "object",
      properties: [
        {
          name: "status",
          type: {
            kind: "enum",
            name: "Status",
            members: [
              { name: "Active", value: "active" },
              { name: "Inactive", value: "inactive" },
            ],
          },
          optional: false,
        },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain('status: "active" | "inactive"');
    expect(code).not.toContain("const enum");
  });

  it("emits enum as literal union in type annotation (numeric enum)", () => {
    const t = target("WithNumEnum", {
      kind: "object",
      properties: [
        {
          name: "priority",
          type: {
            kind: "enum",
            name: "Priority",
            members: [
              { name: "Low", value: 0 },
              { name: "Medium", value: 1 },
              { name: "High", value: 2 },
            ],
          },
          optional: false,
        },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("priority: 0 | 1 | 2");
    expect(code).not.toContain("const enum");
  });

  it("emits type alias for recursive refs", () => {
    const t = target("TreeNode", {
      kind: "object",
      properties: [
        {
          name: "children",
          type: { kind: "array", element: { kind: "ref", name: "TreeNode" } },
          optional: false,
        },
        { name: "value", type: { kind: "number" }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("type TreeNode = { children: TreeNode[]; value: number };");
  });

  it("no enum declarations needed — enums are inline literal unions", () => {
    const enumType = {
      kind: "enum" as const,
      name: "Status",
      members: [
        { name: "Active", value: "active" as const },
        { name: "Inactive", value: "inactive" as const },
      ],
    };
    const t1 = target("Foo", {
      kind: "object",
      properties: [
        { name: "status", type: enumType, optional: false },
      ],
    });
    const t2 = target("Bar", {
      kind: "object",
      properties: [
        { name: "status", type: enumType, optional: false },
      ],
    });
    const code = generateHashFile([t1, t2]);
    // No const enum — enums are represented as literal unions
    expect(code).not.toContain("const enum");
    expect(code).not.toContain("enum Status");
    // Both functions should have the literal union in their annotation
    expect(code).toContain('"active" | "inactive"');
  });

  it("emits Array.isArray check for array | object unions", () => {
    const t = target("ArrayOrObj", {
      kind: "union",
      members: [
        { kind: "array", element: { kind: "string" } },
        {
          kind: "object",
          properties: [
            { name: "length", type: { kind: "number" }, optional: false },
          ],
        },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("Array.isArray(value)");
    // Should NOT fall through to JSON.stringify
    expect(code).not.toContain("JSON.stringify");
    expect(code).toMatchSnapshot();
  });

  it("emits Array.isArray + typeof for array | object | string unions", () => {
    const t = target("MixedUnion", {
      kind: "union",
      members: [
        { kind: "array", element: { kind: "number" } },
        {
          kind: "object",
          properties: [
            { name: "x", type: { kind: "number" }, optional: false },
          ],
        },
        { kind: "string" },
      ],
    });
    const code = generateHashFile([t]);
    // Array.isArray splits arrays from the rest
    expect(code).toContain("Array.isArray(value)");
    // typeof splits string from object in the non-array branch
    expect(code).toContain('typeof value === "string"');
    expect(code).toMatchSnapshot();
  });

  it("emits Date hash with tag byte", () => {
    const t = target("WithDate", {
      kind: "object",
      properties: [
        { name: "created", type: { kind: "date" }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("h.u8(0xD0)");
    expect(code).toContain(".getTime()");
    expect(code).toMatchSnapshot();
  });

  it("emits Map hash with tag byte and sorted entries", () => {
    const t = target("WithMap", {
      kind: "object",
      properties: [
        { name: "scores", type: { kind: "map", keyType: { kind: "string" }, valueType: { kind: "number" } }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("h.u8(0xD1)");
    expect(code).toContain(".entries()");
    expect(code).toContain(".sort(");
    expect(code).toMatchSnapshot();
  });

  it("emits Set hash with tag byte and sorted values", () => {
    const t = target("WithSet", {
      kind: "object",
      properties: [
        { name: "tags", type: { kind: "set", elementType: { kind: "string" } }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("h.u8(0xD2)");
    expect(code).toContain(".values()");
    expect(code).toContain(".sort()");
    expect(code).toMatchSnapshot();
  });

  it("emits instanceof checks for Date | number union", () => {
    const t = target("DateOrNum", {
      kind: "union",
      members: [
        { kind: "date" },
        { kind: "number" },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("instanceof Date");
    expect(code).toContain("h.u8(0xD0)");
    expect(code).toContain("h.f64(value)");
    expect(code).toMatchSnapshot();
  });

  it("emits instanceof checks for Map | object union", () => {
    const t = target("MapOrObj", {
      kind: "union",
      members: [
        { kind: "map", keyType: { kind: "string" }, valueType: { kind: "number" } },
        { kind: "indexSignature", keyType: "string", valueType: { kind: "number" } },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("instanceof Map");
    expect(code).toMatchSnapshot();
  });

  it("emits instanceof + Array.isArray for Set | array union", () => {
    const t = target("SetOrArr", {
      kind: "union",
      members: [
        { kind: "set", elementType: { kind: "string" } },
        { kind: "array", element: { kind: "string" } },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain("instanceof Set");
    expect(code).toContain("Array.isArray");
    expect(code).toMatchSnapshot();
  });

  it("uses bracket notation for non-identifier property names", () => {
    const t = target("Headers", {
      kind: "object",
      properties: [
        { name: "content-type", type: { kind: "string" }, optional: false },
        { name: "x-request-id", type: { kind: "string" }, optional: false },
        { name: "normal", type: { kind: "string" }, optional: false },
      ],
    });
    const code = generateHashFile([t]);
    expect(code).toContain('value["content-type"]');
    expect(code).toContain('value["x-request-id"]');
    expect(code).toContain("value.normal");
    expect(code).not.toContain('value["normal"]');
    expect(code).toMatchSnapshot();
  });

  it("uses custom hasher import path", () => {
    const t = target("Point", {
      kind: "object",
      properties: [
        { name: "x", type: { kind: "number" }, optional: false },
      ],
    });
    const code = generateHashFile([t], "../lib/hasher");
    expect(code).toContain('import { Hasher } from "../lib/hasher"');
  });

  it("generates correct code for nested index signatures without variable shadowing", () => {
    const t = target("NestedMap", {
      kind: "indexSignature",
      keyType: "string",
      valueType: {
        kind: "indexSignature",
        keyType: "string",
        valueType: { kind: "number" },
      },
    });
    const code = generateHashFile([t]);
    expect(code).toContain("const _keys = Object.keys(value).sort()");
    expect(code).toContain("for (const _k of _keys)");
    expect(code).toContain("const _keys1 = Object.keys(value[_k]).sort()");
    expect(code).toContain("for (const _k1 of _keys1)");
    expect(code).toMatchSnapshot();
  });
});
