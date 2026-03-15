/**
 * Bidirectional field mappings between toml configs and generated json files.
 *
 * Each field lens defines get (toml → json value) and put (json value → toml)
 * right next to each other. composeLens merges them into a single object lens.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { produce } from "immer";
import * as Paths from "../paths.mjs";

// ── lens types ────────────────────────────────────────────────

export interface Lens<S, A> {
  get(source: S): A;
  put(source: S, value: A): S;
}

interface FieldLens<S> {
  key: string;
  lens: Lens<S, unknown>;
}

/**
 * Define a single field's bidirectional mapping.
 * get: source → json value for this key (undefined = omit key)
 * put: (source, json value) → updated source
 *
 * put can call this.get(source) to compare against the derived value,
 * so use non-arrow functions.
 */
function field<S>(key: string, lens: Lens<S, unknown>): FieldLens<S> {
  return { key, lens };
}

/** Generate-only field — put is identity (changes on json side are ignored). */
function readonlyField<S>(key: string, get: (source: S) => unknown): FieldLens<S> {
  return { key, lens: { get, put: (s, _) => s } };
}

/**
 * Compose multiple field lenses into a single object lens.
 * get: runs each field's get, assembles into { key: value } (skipping undefined)
 * put: runs each field's put in sequence, threading the source through
 */
function composeLens<S>(...fields: FieldLens<S>[]): Lens<S, Record<string, unknown>> {
  return {
    get(source) {
      const result: Record<string, unknown> = {};
      for (const f of fields) {
        const v = f.lens.get(source);
        if (v !== undefined) result[f.key] = v;
      }
      return result;
    },
    put(source, target) {
      let s = source;
      for (const f of fields) {
        s = f.lens.put(s, target[f.key]);
      }
      return s;
    },
  };
}

// ── helpers ───────────────────────────────────────────────────

/** Drop keys with undefined/null/empty-object values. */
export function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    result[k] = v;
  }
  return result;
}

export function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
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

export function toJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

export function toYaml(obj: Record<string, unknown>): string {
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

// ── root package.json ─────────────────────────────────────────

export function rootPackageJsonLens(workspaceDir: string): Lens<WorkspaceConfig, Record<string, unknown>> {
  return composeLens<WorkspaceConfig>(
    field("name", {
      get: ws => ws.workspace?.name ?? workspaceDir,
      put(ws, name) {
        if (!name || name === this.get(ws)) return ws;
        return produce(ws, d => { (d.workspace ??= {}).name = name as string; });
      },
    }),

    field("version", {
      get: ws => ws.workspace?.version ?? "0.0.0",
      put(ws, version) {
        if (!version || version === this.get(ws)) return ws;
        return produce(ws, d => { (d.workspace ??= {}).version = version as string; });
      },
    }),

    field("type", {
      get: ws => ws.workspace?.type ?? "module",
      put(ws, type) {
        if (!type || type === this.get(ws)) return ws;
        return produce(ws, d => { (d.workspace ??= {}).type = type as string; });
      },
    }),

    field("engines", {
      get: ws => ws.engines ? compact({ node: ws.engines.node, pnpm: ws.engines.pnpm }) : undefined,
      put(ws, engines) {
        const e = engines as Record<string, string> | undefined;
        if (!e) {
          return ws.engines ? produce(ws, d => { delete d.engines; }) : ws;
        }
        return produce(ws, d => { d.engines = { node: e.node, pnpm: e.pnpm }; });
      },
    }),

    field("packageManager", {
      get: ws => ws.engines?.pnpm ? `pnpm@${ws.engines.pnpm}` : undefined,
      put(ws, pm) {
        const str = pm as string | undefined;
        if (!str || str === this.get(ws)) return ws;
        const match = str.match(/^pnpm@(.+)$/);
        if (!match) return ws;
        return produce(ws, d => { (d.engines ??= {}).pnpm = match[1]; });
      },
    }),

    field("volta", {
      get: ws => ws.engines?.node ? { node: ws.engines.node } : undefined,
      put(ws, volta) {
        const node = (volta as Record<string, string> | undefined)?.node;
        if (!node || node === ws.engines?.node) return ws;
        return produce(ws, d => { (d.engines ??= {}).node = node; });
      },
    }),

    field("dependencies", {
      get: ws => {
        const deps = ws.workspace?.dependencies;
        return deps && Object.keys(deps).length > 0 ? deps : undefined;
      },
      put(ws, deps) {
        const d = (deps ?? {}) as Record<string, string>;
        return produce(ws, draft => {
          if (Object.keys(d).length > 0) {
            (draft.workspace ??= {}).dependencies = d;
          } else {
            delete draft.workspace?.dependencies;
          }
        });
      },
    }),

    field("devDependencies", {
      get: ws => {
        const deps = ws.workspace?.devDependencies;
        return deps && Object.keys(deps).length > 0 ? deps : undefined;
      },
      put(ws, deps) {
        const d = (deps ?? {}) as Record<string, string>;
        return produce(ws, draft => {
          if (Object.keys(d).length > 0) {
            (draft.workspace ??= {}).devDependencies = d;
          } else {
            delete draft.workspace?.devDependencies;
          }
        });
      },
    }),

    field("scripts", {
      get: ws => {
        const scripts: Record<string, string> = {
          re: "tsx re/cli.mts",
        };
        if (ws.scripts) {
          for (const [name, cmd] of Object.entries(ws.scripts)) {
            scripts[name] = cmd;
          }
        }
        return scripts;
      },
      put(ws, scripts) {
        const s = scripts as Record<string, string> | undefined;
        if (!s) return ws;
        // strip the built-in "re" script, sync the rest back
        const { re: _, ...rest } = s;
        const hasScripts = Object.keys(rest).length > 0;
        if (!hasScripts && !ws.scripts) return ws;
        return produce(ws, d => { d.scripts = hasScripts ? rest : undefined; });
      },
    }),
  );
}

// ── vscode settings.json ──────────────────────────────────────

/**
 * Settings lens. get merges workspace settings + local overrides.
 * put strips keys owned by local.json and syncs the rest back to workspace.toml.
 *
 * Reads local settings from disk on every call so it's never stale.
 */
export function settingsJsonLens(
  vscodePath: string,
): Lens<WorkspaceConfig, Record<string, unknown>> {
  const localPath = join(vscodePath, "settings.local.json");

  function readLocal(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(localPath, "utf-8"));
    } catch {
      return {};
    }
  }

  return {
    get(ws) {
      const base = ws.vscode?.settings ?? {};
      const local = readLocal();
      let settingsOnly = true;
      try {
        const entries = readdirSync(vscodePath);
        settingsOnly = entries.every(e => e === "settings.json");
      } catch {}
      const filesExclude = Object.fromEntries(
        Paths.FILEIGNORE_LIST(settingsOnly).map(f => [f, true]),
      );
      return deepMerge(
        { "files.exclude": filesExclude, ...structuredClone(base) } as Record<string, unknown>,
        local,
      );
    },
    put(ws, settings) {
      if (!settings) {
        if (!ws.vscode?.settings) return ws;
        return produce(ws, d => { delete d.vscode!.settings; });
      }
      const local = readLocal();
      const synced: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(settings)) {
        if (k === "files.exclude") continue;
        if (!(k in local)) {
          synced[k] = v;
        }
      }
      return produce(ws, d => {
        (d.vscode ??= {}).settings = synced;
      });
    },
  };
}

// ── project package.json ──────────────────────────────────────

/** Deps field lens — straight passthrough, no workspace merging. */
function depsField(key: "dependencies" | "devDependencies"): FieldLens<ProjectConfig> {
  return field(key, {
    get: project => {
      const deps = project.package?.[key];
      return deps && Object.keys(deps).length > 0 ? deps : undefined;
    },
    put(project, deps) {
      const d = (deps ?? {}) as Record<string, string>;
      if (Object.keys(d).length > 0) {
        return produce(project, draft => { (draft.package ??= {})[key] = d; });
      } else {
        return produce(project, draft => { delete draft.package?.[key]; });
      }
    },
  });
}

export function projectPackageJsonLens(
  ws: WorkspaceConfig,
  projectDir: string,
): Lens<ProjectConfig, Record<string, unknown>> {
  const wsPkg = ws.workspace ?? {};

  return composeLens<ProjectConfig>(
    field("name", {
      get: p => p.package?.name ?? wsPkg.name ?? projectDir,
      put(p, name) {
        if (!name || name === this.get(p)) return p;
        return produce(p, d => { (d.package ??= {}).name = name as string; });
      },
    }),

    field("version", {
      get: p => p.package?.version ?? wsPkg.version ?? "0.0.0",
      put(p, version) {
        if (!version || version === this.get(p)) return p;
        return produce(p, d => { (d.package ??= {}).version = version as string; });
      },
    }),

    field("type", {
      get: p => p.package?.type ?? wsPkg.type ?? "module",
      put(p, type) {
        if (!type || type === this.get(p)) return p;
        return produce(p, d => { (d.package ??= {}).type = type as string; });
      },
    }),

    depsField("dependencies"),
    depsField("devDependencies"),
  );
}

// ── project tsconfig.json ─────────────────────────────────────

export function projectTsconfigLens(
  ws: WorkspaceConfig,
): Lens<ProjectConfig, Record<string, unknown> | null> {
  return {
    get: project => {
      const wsOpts = ws.tsconfig?.compilerOptions ?? {};
      const projOpts = project.tsconfig?.compilerOptions ?? {};
      if (Object.keys(wsOpts).length === 0 && Object.keys(projOpts).length === 0) return null;
      return {
        compilerOptions: {
          ...wsOpts,
          ...projOpts,
          composite: true,
          declaration: true,
          outDir: (projOpts.outDir as string | undefined) ?? "dist",
        },
      };
    },
    put(project, _tsconfig) { return project; },
  };
}
