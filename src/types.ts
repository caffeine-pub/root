/** Parsed workspace.toml */
export interface WorkspaceConfig {
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
}

/** Parsed project.toml (lives in each package dir) */
export interface ProjectConfig {
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
export interface ResolvedProject {
  /** Directory name relative to workspace root */
  dir: string;

  /** Absolute path to directory */
  path: string;

  /** Parsed project.toml, or empty defaults if no project.toml exists */
  config: ProjectConfig;

  /** Whether this project has an explicit project.toml */
  hasProjectToml: boolean;
}

/** Generated output files for a project */
export interface GeneratedFiles {
  /** path relative to workspace root -> file content */
  files: Map<string, string>;
}
