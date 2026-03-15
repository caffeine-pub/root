import { join } from "node:path";
import type { WorkspaceConfig, ResolvedProject } from "./types.js";

/**
 * Deep merge two objects. `override` wins on conflicts.
 * Arrays are replaced, not concatenated.
 */
function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val && typeof val === "object" && !Array.isArray(val) && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, val as Record<string, unknown>) as T[keyof T];
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

/** Serialize an object to JSON with 2-space indent and trailing newline */
function toJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

/** Serialize an object to YAML (simple flat/list only — no nested objects) */
function toYaml(obj: Record<string, unknown>): string {
  let out = "";
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      out += `${key}:\n`;
      for (const item of value) {
        out += `  - ${item}\n`;
      }
    } else {
      out += `${key}: ${value}\n`;
    }
  }
  return out;
}

/**
 * Generate the root-level files from workspace.toml:
 * - pnpm-workspace.yaml
 * - tsconfig.base.json
 * - .npmrc
 * - .nvmrc
 * - root package.json
 */
export function generateRootFiles(config: WorkspaceConfig, projects: ResolvedProject[]): Map<string, string> {
  const files = new Map<string, string>();

  // pnpm-workspace.yaml
  files.set(
    "pnpm-workspace.yaml",
    toYaml({ packages: projects.map((p) => p.dir) })
  );

  // tsconfig.base.json
  if (config.tsconfig) {
    files.set("tsconfig.base.json", toJson(config.tsconfig));
  }

  // .npmrc — always pin exact versions
  files.set(".npmrc", "save-prefix=\n");

  // .nvmrc
  if (config.engines?.node) {
    files.set(".nvmrc", config.engines.node + "\n");
  }

  // root package.json
  const rootPkg: Record<string, unknown> = {};
  if (config.workspace?.name) rootPkg.name = config.workspace.name;
  if (config.workspace?.version) rootPkg.version = config.workspace.version;
  if (config.workspace?.type) rootPkg.type = config.workspace.type;

  if (config.engines) {
    const engines: Record<string, string> = {};
    if (config.engines.node) engines.node = config.engines.node;
    if (config.engines.pnpm) engines.pnpm = config.engines.pnpm;
    rootPkg.engines = engines;

    if (config.engines.pnpm) {
      rootPkg.packageManager = `pnpm@${config.engines.pnpm}`;
    }

    rootPkg.volta = {};
    if (config.engines.node) (rootPkg.volta as Record<string, string>).node = config.engines.node;
  }

  files.set("package.json", toJson(rootPkg));

  return files;
}

/**
 * Generate files for a single project:
 * - <dir>/package.json
 * - <dir>/tsconfig.json
 *
 * Merges workspace config (base) with project config (override).
 */
export function generateProjectFiles(
  config: WorkspaceConfig,
  project: ResolvedProject,
): Map<string, string> {
  const files = new Map<string, string>();

  // --- package.json ---
  const workspacePkg = config.workspace ?? {};
  const projectPkg = project.config.package ?? {};

  const pkg: Record<string, unknown> = {
    name: projectPkg.name ?? project.dir,
    version: projectPkg.version ?? workspacePkg.version ?? "0.0.0",
    type: projectPkg.type ?? workspacePkg.type ?? "module",
  };

  // merge dependencies: workspace deps are inherited, project deps override/extend
  const deps = {
    ...(workspacePkg.dependencies ?? {}),
    ...(projectPkg.dependencies ?? {}),
  };
  if (Object.keys(deps).length > 0) pkg.dependencies = deps;

  const devDeps = {
    ...(workspacePkg.devDependencies ?? {}),
    ...(projectPkg.devDependencies ?? {}),
  };
  if (Object.keys(devDeps).length > 0) pkg.devDependencies = devDeps;

  files.set(join(project.dir, "package.json"), toJson(pkg));

  // --- tsconfig.json ---
  const workspaceTsconfig = config.tsconfig?.compilerOptions;
  const projectTsconfig = project.config.tsconfig?.compilerOptions;

  // only generate if there's some tsconfig config
  if (workspaceTsconfig || projectTsconfig) {
    const tsconfig: Record<string, unknown> = {};

    // extend base if workspace has tsconfig
    if (workspaceTsconfig) {
      tsconfig.extends = "../tsconfig.base.json";
    }

    // project-level compiler options (overrides only — base is in extends)
    if (projectTsconfig) {
      tsconfig.compilerOptions = {
        ...projectTsconfig,
        outDir: (projectTsconfig.outDir as string | undefined) ?? "dist",
      };
    } else {
      tsconfig.compilerOptions = {
        outDir: "dist",
      };
    }

    files.set(join(project.dir, "tsconfig.json"), toJson(tsconfig));
  }

  return files;
}

/**
 * Generate all files for the entire workspace.
 */
export function generateAll(config: WorkspaceConfig, projects: ResolvedProject[]): Map<string, string> {
  const files = generateRootFiles(config, projects);

  for (const project of projects) {
    const projectFiles = generateProjectFiles(config, project);
    for (const [path, content] of projectFiles) {
      files.set(path, content);
    }
  }

  return files;
}
