import { describe, it, expect } from "vitest";
import ts from "typescript";
import path from "path";
import { extractHashTargets } from "../src/walker.js";

function createProgram() {
  const fixtureFile = path.resolve(__dirname, "fixtures/types.ts");
  const program = ts.createProgram([fixtureFile], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
  });
  return program;
}

describe("walker", () => {
  const program = createProgram();
  const targets = extractHashTargets(program);

  it("finds all @hash-tagged types and ignores untagged", () => {
    const names = targets.map((t) => t.name);
    expect(names).toContain("User");
    expect(names).toContain("Point");
    expect(names).toContain("Status");
    expect(names).toContain("WithOptional");
    expect(names).toContain("Nested");
    expect(names).toContain("WithArray");
    expect(names).toContain("WithTuple");
    expect(names).toContain("Recursive");
    expect(names).toContain("Union");
    expect(names).toContain("WithBigInt");
    expect(names).toContain("WithBoolean");
    expect(names).toContain("WithNull");
    expect(names).not.toContain("Ignored");
  });

  it("walks User correctly", () => {
    const user = targets.find((t) => t.name === "User")!;
    expect(user.node).toMatchSnapshot();
  });

  it("sorts properties alphabetically", () => {
    const user = targets.find((t) => t.name === "User")!;
    expect(user.node.kind).toBe("object");
    if (user.node.kind === "object") {
      const names = user.node.properties.map((p) => p.name);
      expect(names).toEqual(["age", "email", "name"]);
    }
  });

  it("walks Point correctly", () => {
    const point = targets.find((t) => t.name === "Point")!;
    expect(point.node).toMatchSnapshot();
  });

  it("walks string literal union", () => {
    const status = targets.find((t) => t.name === "Status")!;
    expect(status.node).toMatchSnapshot();
  });

  it("marks optional properties", () => {
    const wo = targets.find((t) => t.name === "WithOptional")!;
    expect(wo.node.kind).toBe("object");
    if (wo.node.kind === "object") {
      const req = wo.node.properties.find((p) => p.name === "required")!;
      const opt = wo.node.properties.find((p) => p.name === "optional")!;
      expect(req.optional).toBe(false);
      expect(opt.optional).toBe(true);
    }
  });

  it("walks nested types", () => {
    const nested = targets.find((t) => t.name === "Nested")!;
    expect(nested.node).toMatchSnapshot();
  });

  it("walks arrays", () => {
    const wa = targets.find((t) => t.name === "WithArray")!;
    expect(wa.node).toMatchSnapshot();
  });

  it("walks tuples", () => {
    const wt = targets.find((t) => t.name === "WithTuple")!;
    expect(wt.node).toMatchSnapshot();
  });

  it("handles recursive types", () => {
    const rec = targets.find((t) => t.name === "Recursive")!;
    expect(rec.node).toMatchSnapshot();
  });

  it("walks discriminated unions", () => {
    const union = targets.find((t) => t.name === "Union")!;
    expect(union.node).toMatchSnapshot();
  });

  it("walks bigint", () => {
    const wb = targets.find((t) => t.name === "WithBigInt")!;
    expect(wb.node).toMatchSnapshot();
  });

  it("walks boolean", () => {
    const wb = targets.find((t) => t.name === "WithBoolean")!;
    expect(wb.node).toMatchSnapshot();
  });

  it("walks nullable types", () => {
    const wn = targets.find((t) => t.name === "WithNull")!;
    expect(wn.node).toMatchSnapshot();
  });

  it("walks generic Box<T> with one type param", () => {
    const box = targets.find((t) => t.name === "Box")!;
    expect(box.typeParams).toHaveLength(1);
    expect(box.typeParams[0].name).toBe("T");
    expect(box.typeParams[0].constraint).toBeNull();
    expect(box.node).toMatchSnapshot();
  });

  it("walks generic Pair<A, B> with two type params", () => {
    const pair = targets.find((t) => t.name === "Pair")!;
    expect(pair.typeParams).toHaveLength(2);
    expect(pair.typeParams[0].name).toBe("A");
    expect(pair.typeParams[1].name).toBe("B");
    expect(pair.node).toMatchSnapshot();
  });

  it("walks generic Container<T> with array of T", () => {
    const container = targets.find((t) => t.name === "Container")!;
    expect(container.typeParams).toHaveLength(1);
    expect(container.typeParams[0].name).toBe("T");
    expect(container.node).toMatchSnapshot();
  });

  it("walks constrained generic with hash constraint", () => {
    const constrained = targets.find((t) => t.name === "Constrained")!;
    expect(constrained.typeParams).toHaveLength(1);
    expect(constrained.typeParams[0].name).toBe("T");
    expect(constrained.typeParams[0].constraint).not.toBeNull();
    expect(constrained.typeParams[0].constraint).toMatchSnapshot();
  });

  it("non-generic types have empty typeParams", () => {
    const user = targets.find((t) => t.name === "User")!;
    expect(user.typeParams).toEqual([]);
  });

  it("walks generic type alias Result<T, E>", () => {
    const result = targets.find((t) => t.name === "Result")!;
    expect(result.typeParams).toHaveLength(2);
    expect(result.typeParams[0].name).toBe("T");
    expect(result.typeParams[1].name).toBe("E");
    expect(result.node).toMatchSnapshot();
  });

  it("walks generic class GenericClass<T>", () => {
    const gc = targets.find((t) => t.name === "GenericClass")!;
    expect(gc.typeParams).toHaveLength(1);
    expect(gc.typeParams[0].name).toBe("T");
    expect(gc.node).toMatchSnapshot();
  });

  it("walks pure string index signature", () => {
    const sm = targets.find((t) => t.name === "StringMap")!;
    expect(sm.node.kind).toBe("indexSignature");
    expect(sm.node).toMatchSnapshot();
  });

  it("walks pure number index signature", () => {
    const nm = targets.find((t) => t.name === "NumberMap")!;
    expect(nm.node.kind).toBe("indexSignature");
    expect(nm.node).toMatchSnapshot();
  });

  it("walks Record<string, number> (mapped type)", () => {
    const ur = targets.find((t) => t.name === "UserRecord")!;
    expect(ur.node).toMatchSnapshot();
  });

  it("walks Pick<User, 'name' | 'age'> (mapped type)", () => {
    const pu = targets.find((t) => t.name === "PickedUser")!;
    expect(pu.node).toMatchSnapshot();
  });

  it("walks Readonly<Point> (mapped type)", () => {
    const rp = targets.find((t) => t.name === "ReadonlyPoint")!;
    expect(rp.node).toMatchSnapshot();
  });

  it("walks intersection with overlapping props — flattened, no duplicates", () => {
    const t = targets.find((t) => t.name === "UserWithExtra")!;
    // Intersection of objects should flatten into a single object
    expect(t.node.kind).toBe("object");
    if (t.node.kind === "object") {
      const names = t.node.properties.map((p) => p.name);
      // User has name, age, email. Intersection adds id and extra.
      // No duplicates — each prop appears exactly once.
      expect(names).toEqual(["age", "email", "extra", "id", "name"]);
    }
    expect(t.node).toMatchSnapshot();
  });

  it("walks mixed named props + string index signature — collapses to pure indexSignature", () => {
    const mi = targets.find((t) => t.name === "MixedIndex")!;
    // String index sig absorbs all named string-keyed props,
    // leaving no named props — so it collapses to a pure indexSignature
    expect(mi.node.kind).toBe("indexSignature");
    expect(mi.node).toMatchSnapshot();
  });
});
