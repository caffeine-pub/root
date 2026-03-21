import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const CLI = path.resolve(__dirname, "../src/cli.ts");
const TMP = path.resolve(__dirname, "../.test-project");

function run(args = "") {
  return execSync(`npx tsx ${CLI} ${args}`, {
    cwd: TMP,
    encoding: "utf-8",
    timeout: 15000,
  });
}

describe("cli", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(TMP, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );
  });

  afterEach(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("generates hash.gen.ts for @hash types", () => {
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `/** @hash */
export interface User {
  name: string;
  age: number;
}
`,
    );

    const out = run();
    expect(out).toContain("1 types");

    const gen = fs.readFileSync(path.join(TMP, "hash.gen.ts"), "utf-8");
    expect(gen).toContain("hashUser");
    expect(gen).toContain("h.str(value.name)");
    expect(gen).toContain("h.f64(value.age)");
    expect(gen).toContain('import { Hasher } from "ts-hash"');
  });

  it("auto-adds hash path alias to tsconfig", () => {
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `/** @hash */
export interface Point { x: number; y: number; }
`,
    );

    run();

    const tsconfig = JSON.parse(fs.readFileSync(path.join(TMP, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.paths).toEqual({ hash: ["./hash.gen.ts"] });
    expect(tsconfig.compilerOptions.baseUrl).toBe(".");
  });

  it("doesn't re-add path alias if already present", () => {
    fs.writeFileSync(
      path.join(TMP, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
            baseUrl: ".",
            paths: { hash: ["./hash.gen.ts"] },
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `/** @hash */
export interface Point { x: number; y: number; }
`,
    );

    const out = run();
    expect(out).not.toContain("added");
  });

  it("skips writing if file hasn't changed", () => {
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `/** @hash */
export interface Point { x: number; y: number; }
`,
    );

    run(); // first run — writes
    const out2 = run(); // second run — should skip
    expect(out2).toContain("up to date");
  });

  it("handles no @hash types gracefully", () => {
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `export interface Ignored { x: number; }`,
    );

    const out = run();
    expect(out).toContain("no @hash-tagged types");

    const gen = fs.readFileSync(path.join(TMP, "hash.gen.ts"), "utf-8");
    expect(gen).toContain("No @hash-tagged types found");
  });

  it("handles recursive types", () => {
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `/** @hash composable */
export type LinkedList<T> = {
  value: T;
  next: LinkedList<T> | null;
};

/** @hash */
export interface Wrapper {
  inner: LinkedList<string>;
}
`,
    );

    const out = run();
    expect(out).toContain("2 types");

    const gen = fs.readFileSync(path.join(TMP, "hash.gen.ts"), "utf-8");
    expect(gen).toContain("_hashLinkedList");
    expect(gen).toContain("hashWrapper");
    expect(gen).toContain("LinkedList<string>");
  });

  it("respects --output flag", () => {
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `/** @hash */
export interface Point { x: number; y: number; }
`,
    );

    run("--output src/generated.ts");

    expect(fs.existsSync(path.join(TMP, "src/generated.ts"))).toBe(true);
    expect(fs.existsSync(path.join(TMP, "hash.gen.ts"))).toBe(false);
  });

  it("respects --hasher-import flag", () => {
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `/** @hash */
export interface Point { x: number; y: number; }
`,
    );

    run("--hasher-import @my/hasher");

    const gen = fs.readFileSync(path.join(TMP, "hash.gen.ts"), "utf-8");
    expect(gen).toContain('import { Hasher } from "@my/hasher"');
  });

  it("excludes the output file from program to avoid circular issues", () => {
    // Pre-create hash.gen.ts with garbage — should not break the CLI
    fs.writeFileSync(path.join(TMP, "hash.gen.ts"), "THIS IS GARBAGE AND SHOULD NOT PARSE");
    fs.writeFileSync(
      path.join(TMP, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            skipLibCheck: true,
          },
          include: ["src", "hash.gen.ts"],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(TMP, "src/types.ts"),
      `/** @hash */
export interface Point { x: number; y: number; }
`,
    );

    // Should succeed despite garbage in hash.gen.ts
    const out = run();
    expect(out).toContain("1 types");
  });
});
