import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { WorkspaceConfig, ResolvedProject, ResolvedWorkspace, ProjectConfig } from "./types.js";

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

// ── root files ────────────────────────────────────────────────

function buildRootPackageJson(workspace: ResolvedWorkspace): Record<string, unknown> {
  const { workspace: ws, engines } = workspace.config;

  return compact({
    name: ws?.name ?? workspace.dir,
    version: ws?.version ?? "0.0.0",
    type: ws?.type ?? "module",
    engines: engines ? compact({ node: engines.node, pnpm: engines.pnpm }) : undefined,
    packageManager: engines?.pnpm ? `pnpm@${engines.pnpm}` : undefined,
    volta: engines?.node ? { node: engines.node } : undefined,
  });
}

export async function generateRootFiles(
  workspace: ResolvedWorkspace,
  projects: ResolvedProject[],
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const config = workspace.config;

  files.set("pnpm-workspace.yaml", toYaml({ packages: projects.map(p => p.dir) }));
  files.set(".npmrc", "save-prefix=\n");

  if (config.tsconfig) {
    files.set("tsconfig.base.json", toJson(config.tsconfig));
  }

  if (config.engines?.node) {
    files.set(".nvmrc", config.engines.node + "\n");
  }

  if (config.prettier) {
    files.set(".prettierrc", toJson(config.prettier));
  }

  if (config.vscode?.settings) {
    let settings = config.vscode.settings;

    // merge .vscode/settings.local.json on top if it exists
    try {
      const localPath = join(workspace.dir, ".vscode", "settings.local.json");
      const local = JSON.parse(await readFile(localPath, "utf-8"));
      settings = deepMerge(
        structuredClone(settings) as Record<string, unknown>,
        local as Record<string, unknown>,
      );
    } catch {}

    files.set(join(".vscode", "settings.json"), toJson(settings));
  }

  files.set("package.json", toJson(buildRootPackageJson(workspace)));

  return files;
}

// ── project files ─────────────────────────────────────────────

function buildProjectPackageJson(
  merged: Record<string, unknown>,
  project: ResolvedProject,
): Record<string, unknown> {
  merged.name = (merged.name as string | undefined) ?? project.dir;
  merged.version ??= "0.0.0";
  merged.type ??= "module";

  return compact(merged);
}

function buildProjectTsconfig(
  wsConfig: WorkspaceConfig,
  project: ResolvedProject,
): Record<string, unknown> | null {
  const wsOpts = wsConfig.tsconfig?.compilerOptions;
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
  workspace: ResolvedWorkspace,
  project: ResolvedProject,
): Map<string, string> {
  const files = new Map<string, string>();

  const base = structuredClone(workspace.config.workspace ?? {}) as Record<string, unknown>;
  delete base.name; // name is never inherited from workspace
  const merged = deepMerge(base, project.config.package ?? {});

  files.set(join(project.dir, "package.json"), toJson(buildProjectPackageJson(merged, project)));

  const tsconfig = buildProjectTsconfig(workspace.config, project);
  if (tsconfig) {
    files.set(join(project.dir, "tsconfig.json"), toJson(tsconfig));
  }

  return files;
}

// ── all ───────────────────────────────────────────────────────

export async function generateAll(
  workspace: ResolvedWorkspace,
  projects: ResolvedProject[],
): Promise<Map<string, string>> {
  const files = await generateRootFiles(workspace, projects);
  for (const project of projects) {
    for (const [path, content] of generateProjectFiles(workspace, project)) {
      files.set(path, content);
    }
  }
  return files;
}
