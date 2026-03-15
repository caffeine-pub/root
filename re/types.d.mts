/** Parsed workspace.toml */
declare interface WorkspaceConfig {
  /** Glob patterns for project discovery. e.g. ["*"], ["packages/*"] */
  projects: string[];

  /** Task definitions. e.g. { dev: "tsc --watch", build: "tsc --build" } */
  scripts?: Record<string, string>;

  /** Node/pnpm version pinning */
  engines?: {
    node?: string;
    pnpm?: string;
  };

  /** Root package.json fields */
  workspace?: {
    name?: string;
    version?: string;
    type?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  /** Base tsconfig.json fields — packages extend this */
  tsconfig?: {
    compilerOptions?: Record<string, unknown>;
  };

  /** Prettier config — used by re to format toml, also generates .prettierrc */
  prettier?: Record<string, unknown>;

  /** VS Code workspace settings → generates .vscode/settings.json */
  vscode?: {
    settings?: Record<string, unknown>;
  };
}

/** Parsed project.toml (lives in each package dir) */
declare interface ProjectConfig {
  /** Package-level package.json fields */
  package?: {
    name?: string;
    version?: string;
    type?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  /** Package-level tsconfig overrides */
  tsconfig?: {
    compilerOptions?: Record<string, unknown>;
  };

  /** Package-level script overrides */
  scripts?: Record<string, string>;
}

/** A discovered project (resolved from glob + optional project.toml) */
declare interface ResolvedProject {
  /** Directory name relative to workspace root */
  dir: string;

  /** Absolute path to directory */
  path: string;

  /** Parsed project.toml, or empty defaults if no project.toml exists */
  config: ProjectConfig;

  /** Whether this project has an explicit project.toml */
  hasProjectToml: boolean;
}

/** Resolved workspace (root-level, analogous to ResolvedProject) */
declare interface ResolvedWorkspace {
  /** Absolute path to workspace root */
  dir: string;

  /** Parsed workspace.toml */
  config: WorkspaceConfig;
}

/** Generated output files for a project */
declare interface GeneratedFiles {
  /** path relative to workspace root -> file content */
  files: Map<string, string>;
}
