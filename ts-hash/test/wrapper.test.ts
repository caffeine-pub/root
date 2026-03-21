import { it, expect } from "vitest";
import { extractHashTargets } from "../src/walker.js";
import { generateHashFile } from "../src/codegen.js";
import ts from "typescript";

it("ref name resolves to alias name, not __type", () => {
  const prog = ts.createProgram(["test/fixtures/wrapper_test.ts"], { strict: true });
  const targets = extractHashTargets(prog);

  console.log("=== TARGETS ===");
  for (const t of targets) {
    console.log(`${t.name}:`, JSON.stringify(t.node, null, 2));
  }

  console.log("\n=== CODEGEN ===");
  const code = generateHashFile(targets);
  console.log(code);

  // ref should resolve to LinkedList, not __type
  expect(code).not.toContain("__type");
  expect(code).toContain("LinkedList");
});
