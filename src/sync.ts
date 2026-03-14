import { readFile } from "node:fs/promises";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { dirname, basename, join } from "node:path";
import type { WorkspaceConfig, ProjectConfig } from "./types.js";
import { format as prettierFormat } from "prettier";

/**
 * Given a modified package.json, diff it against what we would have generated,
 * and sync any new/changed/removed dependencies back to the appropriate toml file.
 *
 * Returns the path to the toml file that was modified (workspace.toml or project.toml),
 * or null if no changes were needed.
 */
export async function syncPackageJsonToToml(
  changedPath: string,
  rootDir: string,
  workspaceConfig: WorkspaceConfig,
  prettierConfig?: Record<string, unknown>,
): Promise<string | null> {
  let newPkg: Record<string, unknown>;
  try {
    const content = await readFile(changedPath, "utf-8");
    newPkg = JSON.parse(content);
  } catch {
    // invalid JSON — ignore, will be overwritten on next generate
    return null;
  }

  const dir = dirname(changedPath);
  const isRoot = dir === rootDir;

  if (isRoot) {
    return syncRootPackageJson(newPkg, rootDir, workspaceConfig, prettierConfig);
  } else {
    const projectName = basename(dir);
    return syncProjectPackageJson(newPkg, dir, projectName, rootDir, workspaceConfig, prettierConfig);
  }
}

/**
 * Sync changes from root package.json back to workspace.toml.
 * Currently only syncs engines/volta changes.
 */
async function syncRootPackageJson(
  newPkg: Record<string, unknown>,
  rootDir: string,
  workspaceConfig: WorkspaceConfig,
  prettierConfig?: Record<string, unknown>,
): Promise<string | null> {
  // root package.json is mostly read-only from the tool perspective
  // the only thing that might change externally is if someone runs volta pin
  const volta = newPkg.volta as Record<string, string> | undefined;
  if (volta?.node && volta.node !== workspaceConfig.engines?.node) {
    return updateWorkspaceToml(rootDir, (config) => {
      if (!config.engines) config.engines = {};
      (config.engines as Record<string, string>).node = volta.node;
    }, prettierConfig);
  }

  return null;
}

/**
 * Sync changes from a project's package.json back to its project.toml.
 * Handles added/removed/changed dependencies.
 */
async function syncProjectPackageJson(
  newPkg: Record<string, unknown>,
  projectDir: string,
  _projectName: string,
  rootDir: string,
  workspaceConfig: WorkspaceConfig,
  prettierConfig?: Record<string, unknown>,
): Promise<string | null> {
  const newDeps = (newPkg.dependencies ?? {}) as Record<string, string>;
  const newDevDeps = (newPkg.devDependencies ?? {}) as Record<string, string>;

  // read existing project.toml
  const tomlPath = join(projectDir, "project.toml");
  let existingConfig: ProjectConfig;
  try {
    const content = await readFile(tomlPath, "utf-8");
    existingConfig = parseToml(content) as unknown as ProjectConfig;
  } catch {
    existingConfig = {};
  }

  // workspace-level deps (the "base" that gets inherited)
  const workspaceDeps = workspaceConfig.workspace?.dependencies ?? {};
  const workspaceDevDeps = workspaceConfig.workspace?.devDependencies ?? {};

  // figure out which deps are project-specific (not inherited from workspace)
  const projectDeps: Record<string, string> = {};
  for (const [name, version] of Object.entries(newDeps)) {
    if (workspaceDeps[name] !== version) {
      projectDeps[name] = version;
    }
  }

  const projectDevDeps: Record<string, string> = {};
  for (const [name, version] of Object.entries(newDevDeps)) {
    if (workspaceDevDeps[name] !== version) {
      projectDevDeps[name] = version;
    }
  }

  // check if anything actually changed
  const existingDeps = existingConfig.package?.dependencies ?? {};
  const existingDevDeps = existingConfig.package?.devDependencies ?? {};

  const depsChanged = JSON.stringify(projectDeps) !== JSON.stringify(existingDeps);
  const devDepsChanged = JSON.stringify(projectDevDeps) !== JSON.stringify(existingDevDeps);

  if (!depsChanged && !devDepsChanged) return null;

  // update project.toml
  return updateProjectToml(projectDir, (config) => {
    if (!config.package) config.package = {};

    if (Object.keys(projectDeps).length > 0) {
      config.package.dependencies = projectDeps;
    } else {
      delete config.package.dependencies;
    }

    if (Object.keys(projectDevDeps).length > 0) {
      config.package.devDependencies = projectDevDeps;
    } else {
      delete config.package.devDependencies;
    }
  }, prettierConfig);
}

/**
 * Read workspace.toml, apply a mutation, format with prettier, write back.
 */
async function updateWorkspaceToml(
  rootDir: string,
  mutate: (config: Record<string, unknown>) => void,
  prettierConfig?: Record<string, unknown>,
): Promise<string> {
  const tomlPath = join(rootDir, "workspace.toml");
  const content = await readFile(tomlPath, "utf-8");
  const config = parseToml(content) as Record<string, unknown>;

  mutate(config);

  const raw = stringifyToml(config);
  const formatted = await formatToml(raw, prettierConfig);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(tomlPath, formatted);

  return tomlPath;
}

/**
 * Read project.toml, apply a mutation, format with prettier, write back.
 */
async function updateProjectToml(
  projectDir: string,
  mutate: (config: Record<string, unknown>) => void,
  prettierConfig?: Record<string, unknown>,
): Promise<string> {
  const tomlPath = join(projectDir, "project.toml");
  let config: Record<string, unknown>;
  try {
    const content = await readFile(tomlPath, "utf-8");
    config = parseToml(content) as Record<string, unknown>;
  } catch {
    config = {};
  }

  mutate(config);

  const raw = stringifyToml(config);
  const formatted = await formatToml(raw, prettierConfig);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(tomlPath, formatted);

  return tomlPath;
}

/**
 * Format TOML content using prettier + prettier-plugin-toml.
 */
async function formatToml(content: string, prettierConfig?: Record<string, unknown>): Promise<string> {
  try {
    return await prettierFormat(content, {
      parser: "toml",
      plugins: ["prettier-plugin-toml"],
      ...(prettierConfig ?? {}),
    });
  } catch {
    // if prettier fails, return the raw stringified toml
    return content;
  }
}
