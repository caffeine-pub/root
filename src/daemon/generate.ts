import { join } from "node:path";
import type { WorkspaceConfig, ResolvedProject } from "./types.js";

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (
      val && typeof val === "object" && !Array.isArray(val) &&
      typeof result[key] === "object" && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

function toJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

function toYaml(obj: Record<string, unknown>): string {
  let out = "";
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      out += `${key}:\n`;
      for (const item of value) out += `  - ${item}\n`;
    } else {
      out += `${key}: ${value}\n`;
    }
  }
  return out;
}

/** Drop keys with undefined/null/empty-object values. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    result[k] = v;
  }
  return result;
}

/** Merge two dep records, returning undefined if empty. */
function mergeDeps(
  ...sources: (Record<string, string> | undefined)[]
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  for (const src of sources) {
    if (src) Object.assign(merged, src);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

// ── root files ────────────────────────────────────────────────

function buildRootPackageJson(config: WorkspaceConfig): Record<string, unknown> {
  const { workspace, engines } = config;

  return compact({
    name: workspace?.name,
    version: workspace?.version,
    type: workspace?.type,
    engines: engines ? compact({ node: engines.node, pnpm: engines.pnpm }) : undefined,
    packageManager: engines?.pnpm ? `pnpm@${engines.pnpm}` : undefined,
    volta: engines?.node ? { node: engines.node } : undefined,
  });
}

export function generateRootFiles(
  config: WorkspaceConfig,
  projects: ResolvedProject[],
): Map<string, string> {
  const files = new Map<string, string>();

  files.set("pnpm-workspace.yaml", toYaml({ packages: projects.map(p => p.dir) }));
  files.set(".npmrc", "save-prefix=\n");

  if (config.tsconfig) {
    files.set("tsconfig.base.json", toJson(config.tsconfig));
  }

  if (config.engines?.node) {
    files.set(".nvmrc", config.engines.node + "\n");
  }

  files.set("package.json", toJson(buildRootPackageJson(config)));

  return files;
}

// ── project files ─────────────────────────────────────────────

function buildProjectPackageJson(
  config: WorkspaceConfig,
  project: ResolvedProject,
): Record<string, unknown> {
  const ws = config.workspace ?? {};
  const pkg = project.config.package ?? {};

  return compact({
    name: pkg.name ?? project.dir,
    version: pkg.version ?? ws.version ?? "0.0.0",
    type: pkg.type ?? ws.type ?? "module",
    dependencies: mergeDeps(ws.dependencies, pkg.dependencies),
    devDependencies: mergeDeps(ws.devDependencies, pkg.devDependencies),
  });
}

function buildProjectTsconfig(
  config: WorkspaceConfig,
  project: ResolvedProject,
): Record<string, unknown> | null {
  const wsOpts = config.tsconfig?.compilerOptions;
  const projOpts = project.config.tsconfig?.compilerOptions;

  if (!wsOpts && !projOpts) return null;

  return compact({
    extends: wsOpts ? "../tsconfig.base.json" : undefined,
    compilerOptions: {
      ...(projOpts ?? {}),
      outDir: (projOpts?.outDir as string | undefined) ?? "dist",
    },
  });
}

export function generateProjectFiles(
  config: WorkspaceConfig,
  project: ResolvedProject,
): Map<string, string> {
  const files = new Map<string, string>();

  files.set(join(project.dir, "package.json"), toJson(buildProjectPackageJson(config, project)));

  const tsconfig = buildProjectTsconfig(config, project);
  if (tsconfig) {
    files.set(join(project.dir, "tsconfig.json"), toJson(tsconfig));
  }

  return files;
}

// ── all ───────────────────────────────────────────────────────

export function generateAll(
  config: WorkspaceConfig,
  projects: ResolvedProject[],
): Map<string, string> {
  const files = generateRootFiles(config, projects);
  for (const project of projects) {
    for (const [path, content] of generateProjectFiles(config, project)) {
      files.set(path, content);
    }
  }
  return files;
}
