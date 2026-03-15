import { watch } from "chokidar";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parseWorkspaceToml, discoverProjects } from "./parse.mjs";
import { writeGeneratedFiles, ensureGitignore } from "./write.mjs";
import { validate } from "./validate.mjs";
import { deepDiff } from "./diff.mjs";
import { TomlEditor } from "../../mutate-toml/pkg/mutate_toml.js";
import {
  rootPackageJsonLens,
  projectPackageJsonLens,
  projectTsconfigLens,
  settingsJsonLens,
  toJson,
  toYaml,
  type Lens,
} from "./mapping.mjs";
import * as Paths from "../paths.mjs";

// ── managed file registry ─────────────────────────────────────

interface ManagedEntry {
  /** Generate file content */
  generate: () => string;
  /** Sync external edits back to toml. null = generate-only, no sync. */
  sync: ((newJson: Record<string, unknown>) => Promise<string | null>) | null;
}

/** Global registry: relative path → managed entry */
const registry = new Map<string, ManagedEntry>();

function clearRegistry() {
  registry.clear();
}

/** Helper: create a sync function for a lens-based toml file */
function tomlSync<S>(
  tomlPath: string,
  parse: (src: string) => S,
  empty: S,
  lens: Lens<S, Record<string, unknown>>,
): (newJson: Record<string, unknown>) => Promise<string | null> {
  return async (newJson) => {
    let source: string;
    let config: S;
    try {
      source = await readFile(tomlPath, "utf-8");
      config = parse(source);
    } catch {
      source = "";
      config = empty;
    }

    const updated = lens.put(config, newJson);
    const ops = deepDiff(config, updated);
    if (ops.length === 0) return null;

    const editor = new TomlEditor(source);
    for (const op of ops) {
      switch (op.type) {
        case "set": editor.set(op.path, op.value); break;
        case "remove": editor.remove(op.path); break;
        case "insert_at": editor.insert(op.path, op.index, op.value); break;
        case "remove_at": editor.remove_at(op.path, op.index); break;
      }
    }
    await writeFile(tomlPath, editor.finish());
    return tomlPath;
  };
}

async function readJsonSafe(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return {};
  }
}

/** Build the registry from resolved workspace + projects */
export async function buildRegistry(
  rootDir: string,
  workspace: ResolvedWorkspace,
  projects: ResolvedProject[],
): Promise<void> {
  clearRegistry();

  const config = workspace.config;
  const wsToml = join(rootDir, Paths.WORKSPACE_TOML);
  const parseWs = (src: string) => parseToml(src) as unknown as WorkspaceConfig;

  // ── root package.json ──────────────────────────────────────
  const rootPkgLens = rootPackageJsonLens(rootDir);
  registry.set(Paths.PACKAGE_JSON, {
    generate: () => toJson(rootPkgLens.get(config)),
    sync: tomlSync(wsToml, parseWs, {} as WorkspaceConfig, rootPkgLens),
  });

  // ── .vscode/settings.json ─────────────────────────────────
  if (config.vscode?.settings) {
    const sLens = settingsJsonLens(join(rootDir, Paths.VSCODE));
    registry.set(join(Paths.VSCODE, Paths.SETTINGS_JSON), {
      generate: () => toJson(sLens.get(config)),
      sync: tomlSync(wsToml, parseWs, {} as WorkspaceConfig, sLens),
    });
  }

  // ── pnpm-workspace.yaml ───────────────────────────────────
  registry.set(Paths.PNPM_WORKSPACE, {
    generate: () => toYaml({ packages: projects.map(p => p.dir) }),
    sync: null,
  });

  // ── .npmrc ─────────────────────────────────────────────────
  registry.set(Paths.NPMRC, {
    generate: () => "save-prefix=\n",
    sync: null,
  });

  // ── root tsconfig.json (composite build with project references) ──
  if (config.tsconfig) {
    registry.set(Paths.TSCONFIG, {
      generate: () => toJson({
        compilerOptions: { ...config.tsconfig!.compilerOptions },
        references: projects.map(p => ({ path: p.dir })),
        files: [],
      }),
      sync: null,
    });
  }

  // ── .nvmrc ─────────────────────────────────────────────────
  if (config.engines?.node) {
    registry.set(Paths.NVMRC, {
      generate: () => config.engines!.node + "\n",
      sync: null,
    });
  }

  // ── .prettierrc ────────────────────────────────────────────
  if (config.prettier) {
    registry.set(Paths.PRETTIERRC, {
      generate: () => toJson(config.prettier),
      sync: null,
    });
  }

  // ── per-project files ──────────────────────────────────────
  for (const project of projects) {
    const projToml = join(project.path, Paths.PROJECT_TOML);
    const parseProj = (src: string) => parseToml(src) as unknown as ProjectConfig;

    // project package.json
    const pkgLens = projectPackageJsonLens(config, project.dir);
    registry.set(join(project.dir, Paths.PACKAGE_JSON), {
      generate: () => toJson(pkgLens.get(project.config)),
      sync: tomlSync(projToml, parseProj, {} as ProjectConfig, pkgLens),
    });

    // project tsconfig.json
    const tsLens = projectTsconfigLens(config);
    const tsconfig = tsLens.get(project.config);
    if (tsconfig) {
      registry.set(join(project.dir, Paths.TSCONFIG), {
        generate: () => toJson(tsLens.get(project.config)),
        sync: null, // readonly
      });
    }
  }
}

// ── one-shot generate (for cli) ───────────────────────────────

export async function generateAll(
  rootDir: string,
  workspace: ResolvedWorkspace,
  projects: ResolvedProject[],
): Promise<Map<string, string>> {
  await buildRegistry(rootDir, workspace, projects);
  const files = new Map<string, string>();
  for (const [path, entry] of registry) {
    files.set(path, entry.generate());
  }
  return files;
}

// ── daemon state ──────────────────────────────────────────────

export interface DaemonState {
  rootDir: string;
  workspace: ResolvedWorkspace;
  projects: ResolvedProject[];
  selfWritten: Set<string>;
  generateTimer: ReturnType<typeof setTimeout> | null;
  syncTimer: Map<string, ReturnType<typeof setTimeout>>;
  lastGeneratedFiles: Set<string>;
}

const DEBOUNCE_MS = 100;

// ── daemon ────────────────────────────────────────────────────

export async function startDaemon(rootDir: string): Promise<{ stop: () => Promise<void> }> {
  rootDir = resolve(rootDir);
  console.log(`re: starting in ${rootDir}`);

  const config = await parseWorkspaceToml(rootDir);
  const projects = await discoverProjects(rootDir, config);

  const state: DaemonState = {
    rootDir,
    workspace: { dir: rootDir, config },
    projects,
    selfWritten: new Set(),
    generateTimer: null,
    syncTimer: new Map(),
    lastGeneratedFiles: new Set(),
  };

  await buildRegistry(rootDir, state.workspace, state.projects);
  await regenerate(state);

  // internal: source-of-truth files → changes trigger regeneration
  const internalPaths = [
    join(rootDir, Paths.WORKSPACE_TOML),
    join(rootDir, Paths.VSCODE, Paths.SETTINGS_LOCAL_JSON),
    ...projects.map(p => join(p.path, Paths.PROJECT_TOML)),
  ];

  const internalWatcher = watch(internalPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50 },
  });

  internalWatcher.on("change", changedPath => {
    if (state.selfWritten.delete(changedPath)) return;
    console.log(`re: ${relative(rootDir, changedPath)} changed, regenerating...`);
    if (state.generateTimer) clearTimeout(state.generateTimer);
    state.generateTimer = setTimeout(() => handleTomlChange(state), DEBOUNCE_MS);
  });

  // external: generated files with sync lenses → changes sync back to toml
  const externalPaths = [...registry.entries()]
    .filter(([_, entry]) => entry.sync !== null)
    .map(([relPath]) => join(rootDir, relPath));

  const externalWatcher = watch(externalPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50 },
  });

  externalWatcher.on("change", changedPath => {
    if (state.selfWritten.delete(changedPath)) return;
    console.log(`re: ${relative(rootDir, changedPath)} modified externally, syncing...`);
    const existing = state.syncTimer.get(changedPath);
    if (existing) clearTimeout(existing);
    state.syncTimer.set(
      changedPath,
      setTimeout(() => handleJsonChange(state, changedPath), DEBOUNCE_MS),
    );
  });

  // watch for new project.toml files
  const globWatcher = watch(join(rootDir, "*", Paths.PROJECT_TOML), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50 },
  });

  globWatcher.on("add", newPath => {
    console.log(`re: new project discovered: ${relative(rootDir, newPath)}`);
    if (state.generateTimer) clearTimeout(state.generateTimer);
    state.generateTimer = setTimeout(() => handleTomlChange(state), DEBOUNCE_MS);
  });

  return {
    stop: async () => {
      if (state.generateTimer) clearTimeout(state.generateTimer);
      for (const timer of state.syncTimer.values()) clearTimeout(timer);
      await internalWatcher.close();
      await externalWatcher.close();
      await globWatcher.close();
      console.log("re: stopped");
    },
  };
}

// ── handlers ──────────────────────────────────────────────────

async function handleTomlChange(state: DaemonState): Promise<void> {
  try {
    state.workspace = { dir: state.rootDir, config: await parseWorkspaceToml(state.rootDir) };
    state.projects = await discoverProjects(state.rootDir, state.workspace.config);
    await buildRegistry(state.rootDir, state.workspace, state.projects);
    await regenerate(state);
  } catch (err) {
    console.error("re: error regenerating:", err);
  }
}

async function handleJsonChange(state: DaemonState, changedPath: string): Promise<void> {
  state.syncTimer.delete(changedPath);

  const relPath = relative(state.rootDir, changedPath);
  const entry = registry.get(relPath);

  if (!entry?.sync) {
    console.warn(`re: no sync handler for ${relPath}`);
    return;
  }

  try {
    const newJson = await readJsonSafe(changedPath);
    if (Object.keys(newJson).length === 0) return;

    const modifiedToml = await entry.sync(newJson);

    if (modifiedToml) {
      state.selfWritten.add(modifiedToml);
      console.log(`re: synced to ${relative(state.rootDir, modifiedToml)}`);

      state.workspace = { dir: state.rootDir, config: await parseWorkspaceToml(state.rootDir) };
      state.projects = await discoverProjects(state.rootDir, state.workspace.config);
      await buildRegistry(state.rootDir, state.workspace, state.projects);
      await regenerate(state);
    }
  } catch (err) {
    console.error("re: error syncing:", err);
    await regenerate(state);
  }
}

// ── regenerate ────────────────────────────────────────────────

async function regenerate(state: DaemonState): Promise<void> {
  const warnings = validate(state.workspace, state.projects);
  for (const w of warnings) {
    console.warn(`re: warning: ${w.file} → ${w.path}: ${w.message}`);
  }

  // generate all files from registry
  const files = new Map<string, string>();
  for (const [path, entry] of registry) {
    files.set(path, entry.generate());
  }

  const written = await writeGeneratedFiles(state.rootDir, files);

  for (const path of written) {
    state.selfWritten.add(path);
  }

  // delete files from previous run that aren't in current registry
  const currentFiles = new Set(
    [...files.keys()].map(p => resolve(state.rootDir, p)),
  );
  for (const oldFile of state.lastGeneratedFiles) {
    if (!currentFiles.has(oldFile)) {
      try {
        await unlink(oldFile);
        state.selfWritten.add(oldFile);
        console.log(`re: deleted ${relative(state.rootDir, oldFile)}`);
      } catch {}
    }
  }
  state.lastGeneratedFiles = currentFiles;

  await ensureGitignore(state.rootDir, Paths.GITIGNORE_LIST);

  if (written.size > 0) {
    console.log(`re: wrote ${written.size} file${written.size === 1 ? "" : "s"}`);
  }
}
