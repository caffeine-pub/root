import { readFile, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import type { WorkspaceConfig, ProjectConfig } from "../types.js";
import { deepDiff, type DiffOp } from "./diff.js";
import { TomlEditor } from "../../../mutate-toml/pkg/mutate_toml.js";

/**
 * Apply a list of diff operations to a TOML source string using the CST-preserving editor.
 */
function applyOps(source: string, ops: DiffOp[]): string {
  if (ops.length === 0) return source;

  const editor = new TomlEditor(source);

  for (const op of ops) {
    switch (op.type) {
      case "set":
        editor.set(op.path, op.value);
        break;
      case "remove":
        editor.remove(op.path);
        break;
      case "insert_at":
        editor.insert(op.path, op.index, op.value);
        break;
      case "remove_at":
        editor.remove_at(op.path, op.index);
        break;
    }
  }

  return editor.finish();
}

/**
 * Given a modified package.json, diff it against what we would have generated,
 * and sync any new/changed/removed dependencies back to the appropriate toml file.
 *
 * Returns the path to the toml file that was modified, or null if no changes were needed.
 */
export async function syncPackageJsonToToml(
  changedPath: string,
  rootDir: string,
  workspaceConfig: WorkspaceConfig,
): Promise<string | null> {
  let newPkg: Record<string, unknown>;
  try {
    const content = await readFile(changedPath, "utf-8");
    newPkg = JSON.parse(content);
  } catch {
    return null;
  }

  const dir = dirname(changedPath);
  const isRoot = dir === rootDir;

  if (isRoot) {
    return syncRootPackageJson(newPkg, rootDir, workspaceConfig);
  } else {
    const projectName = basename(dir);
    return syncProjectPackageJson(newPkg, dir, projectName, rootDir, workspaceConfig);
  }
}

/**
 * Sync changes from root package.json back to workspace.toml.
 */
async function syncRootPackageJson(
  newPkg: Record<string, unknown>,
  rootDir: string,
  workspaceConfig: WorkspaceConfig,
): Promise<string | null> {
  const volta = newPkg.volta as Record<string, string> | undefined;
  if (!volta?.node || volta.node === workspaceConfig.engines?.node) {
    return null;
  }

  const oldEngines = { ...(workspaceConfig.engines ?? {}) };
  const newEngines = { ...oldEngines, node: volta.node };

  const ops = deepDiff(oldEngines, newEngines, "engines");
  if (ops.length === 0) return null;

  const tomlPath = join(rootDir, "workspace.toml");
  const source = await readFile(tomlPath, "utf-8");
  const result = applyOps(source, ops);
  await writeFile(tomlPath, result);
  return tomlPath;
}

/**
 * Sync changes from a project's package.json back to its project.toml.
 */
async function syncProjectPackageJson(
  newPkg: Record<string, unknown>,
  projectDir: string,
  _projectName: string,
  rootDir: string,
  workspaceConfig: WorkspaceConfig,
): Promise<string | null> {
  const newDeps = (newPkg.dependencies ?? {}) as Record<string, string>;
  const newDevDeps = (newPkg.devDependencies ?? {}) as Record<string, string>;

  // read existing project.toml
  const tomlPath = join(projectDir, ".project.toml");
  let existingSource: string;
  let existingConfig: ProjectConfig;
  try {
    existingSource = await readFile(tomlPath, "utf-8");
    const { parse } = await import("smol-toml");
    existingConfig = parse(existingSource) as unknown as ProjectConfig;
  } catch {
    existingSource = "";
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

  // build the old and new package sections
  const oldPkg = existingConfig.package ?? {};
  const newPkgSection: Record<string, unknown> = { ...oldPkg };

  if (Object.keys(projectDeps).length > 0) {
    newPkgSection.dependencies = projectDeps;
  } else {
    delete newPkgSection.dependencies;
  }

  if (Object.keys(projectDevDeps).length > 0) {
    newPkgSection.devDependencies = projectDevDeps;
  } else {
    delete newPkgSection.devDependencies;
  }

  const ops = deepDiff(oldPkg, newPkgSection, "package");
  if (ops.length === 0) return null;

  const result = applyOps(existingSource, ops);
  await writeFile(tomlPath, result);
  return tomlPath;
}
