import { parse as parseToml } from "smol-toml";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { glob } from "node:fs/promises";
import type { WorkspaceConfig, ProjectConfig, ResolvedProject } from "./types.js";

/**
 * Parse workspace.toml from a given root directory.
 * Throws if the file doesn't exist or is invalid TOML.
 */
export async function parseWorkspaceToml(rootDir: string): Promise<WorkspaceConfig> {
  const filePath = join(rootDir, "workspace.toml");
  const content = await readFile(filePath, "utf-8");
  const raw = parseToml(content) as Record<string, unknown>;

  return {
    projects: (raw.projects as string[] | undefined) ?? ["*"],
    scripts: raw.scripts as Record<string, string> | undefined,
    engines: raw.engines as WorkspaceConfig["engines"],
    workspace: raw.workspace as WorkspaceConfig["workspace"],
    tsconfig: raw.tsconfig as WorkspaceConfig["tsconfig"],
    prettier: raw.prettier as Record<string, unknown> | undefined,
  };
}

/**
 * Parse a project.toml from a given directory.
 * Returns empty defaults if the file doesn't exist.
 */
export async function parseProjectToml(projectDir: string): Promise<{ config: ProjectConfig; exists: boolean }> {
  const filePath = join(projectDir, ".project.toml");

  if (!existsSync(filePath)) {
    return { config: {}, exists: false };
  }

  const content = await readFile(filePath, "utf-8");
  const raw = parseToml(content) as Record<string, unknown>;

  return {
    config: {
      package: raw.package as ProjectConfig["package"],
      tsconfig: raw.tsconfig as ProjectConfig["tsconfig"],
      scripts: raw.scripts as Record<string, string> | undefined,
    },
    exists: true,
  };
}

/**
 * Discover all projects matching the `projects` globs in workspace.toml.
 * A directory matches if:
 * - it matches one of the glob patterns
 * - it contains a project.toml, OR `projects` globs explicitly include it
 */
export async function discoverProjects(rootDir: string, config: WorkspaceConfig): Promise<ResolvedProject[]> {
  const projects: ResolvedProject[] = [];
  const seen = new Set<string>();

  for (const pattern of config.projects) {
    // resolve glob against rootDir
    const matches = await Array.fromAsync(glob(pattern, { cwd: rootDir }));

    for (const match of matches) {
      const absPath = resolve(rootDir, match);

      // skip if already seen
      if (seen.has(match)) continue;
      seen.add(match);

      // skip dotfiles, node_modules, etc
      if (match.startsWith(".") || match === "node_modules") continue;

      // skip if not a directory
      try {
        const s = await stat(absPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const { config: projectConfig, exists: hasProjectToml } = await parseProjectToml(absPath);

      projects.push({
        dir: match,
        path: absPath,
        config: projectConfig,
        hasProjectToml,
      });
    }
  }

  return projects;
}
