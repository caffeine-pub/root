import { watch } from "chokidar";
import { resolve, join, relative } from "node:path";
import { parseWorkspaceToml, discoverProjects } from "./parse.js";
import { generateAll } from "./generate.js";
import { writeGeneratedFiles, ensureGitignore } from "./write.js";
import { syncPackageJsonToToml } from "./sync/sync.js";
import type { WorkspaceConfig, ResolvedProject, ResolvedWorkspace } from "./types.js";

export interface DaemonState {
  rootDir: string;
  workspace: ResolvedWorkspace;
  projects: ResolvedProject[];
  /** Paths we just wrote — ignore the next change event for these */
  selfWritten: Set<string>;
  /** Debounce timer for toml changes */
  generateTimer: ReturnType<typeof setTimeout> | null;
  /** Debounce timer for package.json changes */
  syncTimer: Map<string, ReturnType<typeof setTimeout>>;
}

const DEBOUNCE_MS = 100;

/**
 * Start the re daemon. Watches workspace.toml, project.toml files,
 * and generated config files for bidirectional sync.
 */
export async function startDaemon(rootDir: string): Promise<{ stop: () => Promise<void> }> {
  rootDir = resolve(rootDir);

  console.log(`re: starting in ${rootDir}`);

  // initial parse + generate
  const config = await parseWorkspaceToml(rootDir);
  const projects = await discoverProjects(rootDir, config);

  const state: DaemonState = {
    rootDir,
    workspace: { dir: rootDir, config },
    projects,
    selfWritten: new Set(),
    generateTimer: null,
    syncTimer: new Map(),
  };

  // initial generation
  await regenerate(state);

  // watch toml files for changes → regenerate
  const tomlPaths = [join(rootDir, "workspace.toml"), ...projects.map(p => join(p.path, ".project.toml"))];

  const tomlWatcher = watch(tomlPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50 },
  });

  tomlWatcher.on("change", changedPath => {
    // skip if we just wrote this file (bidirectional sync wrote back to toml)
    if (state.selfWritten.delete(changedPath)) return;

    console.log(`re: ${relative(rootDir, changedPath)} changed, regenerating...`);

    // debounce
    if (state.generateTimer) clearTimeout(state.generateTimer);
    state.generateTimer = setTimeout(() => handleTomlChange(state), DEBOUNCE_MS);
  });

  // watch generated package.json files for changes → sync back to toml
  const packageJsonPaths = [join(rootDir, "package.json"), ...projects.map(p => join(p.path, "package.json"))];

  const jsonWatcher = watch(packageJsonPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50 },
  });

  jsonWatcher.on("change", changedPath => {
    // skip if we just wrote this file
    if (state.selfWritten.delete(changedPath)) return;

    console.log(`re: ${relative(rootDir, changedPath)} modified externally, syncing...`);

    // debounce per-file
    const existing = state.syncTimer.get(changedPath);
    if (existing) clearTimeout(existing);
    state.syncTimer.set(
      changedPath,
      setTimeout(() => handlePackageJsonChange(state, changedPath), DEBOUNCE_MS),
    );
  });

  // watch for new project.toml files (new packages added)
  const globWatcher = watch(join(rootDir, "*/.project.toml"), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50 },
  });

  globWatcher.on("add", newPath => {
    console.log(`re: new project discovered: ${relative(rootDir, newPath)}`);
    // re-discover and regenerate
    if (state.generateTimer) clearTimeout(state.generateTimer);
    state.generateTimer = setTimeout(() => handleTomlChange(state), DEBOUNCE_MS);
  });

  return {
    stop: async () => {
      if (state.generateTimer) clearTimeout(state.generateTimer);
      for (const timer of state.syncTimer.values()) clearTimeout(timer);
      await tomlWatcher.close();
      await jsonWatcher.close();
      await globWatcher.close();
      console.log("re: stopped");
    },
  };
}

/**
 * Re-parse all toml files and regenerate all config files.
 */
async function handleTomlChange(state: DaemonState): Promise<void> {
  try {
    state.workspace = { dir: state.rootDir, config: await parseWorkspaceToml(state.rootDir) };
    state.projects = await discoverProjects(state.rootDir, state.workspace.config);
    await regenerate(state);
  } catch (err) {
    console.error("re: error regenerating:", err);
  }
}

/**
 * Handle an externally modified package.json — sync changes back to toml,
 * then regenerate.
 */
async function handlePackageJsonChange(state: DaemonState, changedPath: string): Promise<void> {
  state.syncTimer.delete(changedPath);

  try {
    const modifiedToml = await syncPackageJsonToToml(changedPath, state.rootDir, state.workspace.config);

    if (modifiedToml) {
      // mark the toml file as self-written so the toml watcher ignores it
      state.selfWritten.add(modifiedToml);
      console.log(`re: synced to ${relative(state.rootDir, modifiedToml)}`);

      // re-parse and regenerate from the updated toml
      state.workspace = { dir: state.rootDir, config: await parseWorkspaceToml(state.rootDir) };
      state.projects = await discoverProjects(state.rootDir, state.workspace.config);
      await regenerate(state);
    }
  } catch (err) {
    console.error("re: error syncing:", err);
    // on error, regenerate from toml (overwrites the bad edit)
    await regenerate(state);
  }
}

/**
 * Generate all files and write them to disk.
 */
async function regenerate(state: DaemonState): Promise<void> {
  const files = generateAll(state.workspace, state.projects);
  const written = await writeGeneratedFiles(state.rootDir, files);

  // mark all written files as self-written so watchers ignore them
  for (const path of written) {
    state.selfWritten.add(path);
  }

  // update .gitignore
  const generatedPaths = [
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    ".npmrc",
    ".nvmrc",
    ".prettierrc",
    "tsconfig.base.json",
    "node_modules/",
    "**/package.json",
    "**/tsconfig.json",
  ];
  await ensureGitignore(state.rootDir, generatedPaths);

  if (written.size > 0) {
    console.log(`re: wrote ${written.size} file${written.size === 1 ? "" : "s"}`);
  }
}
