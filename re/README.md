# re — Monorepo Configuration Manager

A lightweight tool for managing monorepo configuration through declarative TOML files. `re` generates and synchronizes JSON configuration files (package.json, tsconfig.json, etc.) from a single source of truth.

## Overview

`re` solves the problem of configuration duplication in monorepos. Instead of maintaining separate `package.json` and `tsconfig.json` files in each project, you define configuration once in TOML files and `re` generates the JSON files automatically.

### Features

- **Declarative configuration**: Write configuration once in TOML, not JSON
- **Bi-directional sync**: Changes to generated JSON files sync back to TOML
- **Daemon mode**: Watches for changes and regenerates automatically
- **Multi-workspace**: Support for multiple projects with shared base configuration
- **Lens-based transforms**: Use "lens" transformations to customize per-project configuration
- **WASM-powered**: Uses `mutate-toml` (Rust compiled to WASM) for precise TOML editing

## Installation

`re` is installed as an npm package (`build-re`):

```bash
npm install -D build-re
# or
npx build-re --help
```

## Configuration Files

### workspace.toml

The root workspace configuration file. Defines shared settings and project discovery.

**Location**: `workspace.toml` (root directory)

**Example**:

```toml
# Project discovery patterns
projects = ["*", "packages/*"]

# Root package.json fields
[workspace]
name = "my-monorepo"
version = "1.0.0"
type = "module"

# Dependencies shared across all projects
[workspace.devDependencies]
typescript = "^5.0.0"
prettier = "^3.0.0"

# TypeScript base configuration
[tsconfig.compilerOptions]
target = "ES2020"
module = "ESNext"
strict = true

# VSCode workspace settings
[vscode.settings]
"editor.defaultFormatter" = "esbenp.prettier-vscode"
"editor.formatOnSave" = true

# Prettier formatting options
[prettier]
semi = false
singleQuote = true

# Node/pnpm version pinning
[engines]
node = "20.0.0"
pnpm = "9.0.0"

# Workspace-level scripts
[scripts]
dev = "tsc --watch"
build = "tsc --build"
test = "vitest"
```

### .project.toml

Per-project configuration. Optional — projects don't need a `.project.toml` unless they override workspace defaults.

**Location**: `<project-dir>/.project.toml`

**Example**:

```toml
[package]
name = "my-package"
version = "1.0.0"
public = true       # Set to true to remove "private": true from package.json
files = ["dist"]

[package.bin]
my-tool = "dist/cli.mjs"

[package.scripts]
build = "esbuild src/index.ts --bundle --outfile=dist/index.mjs"
test = "vitest"

[package.devDependencies]
esbuild = "^0.20.0"
vitest = "^1.0.0"

[tsconfig.compilerOptions]
lib = ["ES2020", "DOM"]
noEmit = true

[tsconfig.include]
src = []
```

## Generated Files

`re` generates and manages these files:

| File                      | Source         | Sync | Description                        |
| ------------------------- | -------------- | ---- | ---------------------------------- |
| `package.json`            | workspace.toml | ✓    | Root package metadata              |
| `<project>/package.json`  | project.toml   | ✓    | Project package metadata           |
| `tsconfig.json`           | workspace.toml | ✗    | Root TypeScript config (composite) |
| `<project>/tsconfig.json` | project.toml   | ✗    | Project TypeScript config          |
| `.vscode/settings.json`   | workspace.toml | ✓    | VS Code workspace settings         |
| `.prettierrc`             | workspace.toml | ✗    | Prettier formatting config         |
| `.npmrc`                  | (hardcoded)    | ✗    | npm configuration                  |
| `.nvmrc`                  | workspace.toml | ✗    | Node version file                  |
| `pnpm-workspace.yaml`     | (generated)    | ✗    | pnpm workspace config              |
| `.gitignore`              | (updated)      | ✗    | Adds generated files section       |

**Sync**: If marked ✓, changes to the JSON file are synced back to TOML. Marked ✗ means read-only (re-generate only).

## Commands

### `re start`

Start the daemon in the background. Watches for changes to `.toml` files and regenerates configuration automatically.

```bash
re start
# re: daemon started (pid 12345)
```

The daemon stores its PID in `.re.pid` and can be stopped with `re stop`.

### `re stop`

Stop the running daemon.

```bash
re stop
# re: daemon stopped (pid 12345)
```

### `re generate`

One-shot generation without starting the daemon. Useful for CI/CD pipelines.

```bash
re generate
# re: generated 10 files
```

### `re clean`

Remove all generated files. Useful for cleanup or reset.

```bash
re clean
# re: removed 10 files
```

Scripts are defined in `workspace.toml` under `[scripts]`.

## How It Works

### Daemon Mode

When you run `re start`, it spawns a background process that:

1. **Discovers projects** from glob patterns in `workspace.toml`
2. **Parses configuration** from `workspace.toml` and `*.project.toml` files
3. **Watches for changes**:
   - TOML file changes → regenerate JSON files
   - JSON file changes → sync back to TOML (for files with sync enabled)
4. **Manages file state**: Tracks which files it wrote to avoid re-triggering its own watchers
5. **Cleans up**: Removes generated files from previous runs that are no longer needed

### File Synchronization

The daemon uses "lens" transformations to:

- **Generate**: Extract configuration from TOML and render as JSON
- **Sync**: Read modified JSON, extract changes, and apply them back to TOML using precise WASM-powered edits

This allows you to:

- Edit `package.json` directly and have changes saved to `workspace.toml`
- Edit `tsconfig.json` and have the base configuration updated
- Keep your source of truth in TOML while supporting direct JSON editing

### TOML Mutation

For synchronization, `re` uses `mutate-toml` — a Rust library compiled to WASM that:

- Parses TOML preserving structure and comments
- Applies precise edits (set, remove, insert, delete)
- Serializes back to TOML without destroying formatting

This is why directly editing generated JSON files can sync back to TOML without losing comments or structure.

## Project Discovery

Projects are discovered by matching glob patterns from `workspace.toml`:

```toml
projects = ["*", "packages/*"]
```

Discovery rules:

1. Match glob patterns against the root directory
2. Exclude dotfiles (`.git`, `.vscode`, etc.)
3. Exclude `node_modules`
4. Include only directories (not files)
5. Include projects with or without `.project.toml` files

## Examples

### Basic Monorepo Setup

```
my-monorepo/
├── workspace.toml          # Root configuration
├── package.json            # (generated)
├── tsconfig.json           # (generated)
├── pnpm-workspace.yaml     # (generated)
├── .npmrc                  # (generated)
├── .nvmrc                  # (generated)
├── .vscode/settings.json   # (generated)
├── packages/
│   ├── core/
│   │   ├── .project.toml
│   │   └── package.json    # (generated from core/.project.toml)
│   └── cli/
│       ├── .project.toml
│       └── package.json    # (generated from cli/.project.toml)
└── apps/
    └── web/
        ├── .project.toml
        └── package.json    # (generated)
```

### Sharing Configuration

**workspace.toml**:

```toml
[workspace.devDependencies]
typescript = "^5.0.0"
vitest = "^1.0.0"

[tsconfig.compilerOptions]
target = "ES2020"
strict = true
```

All projects inherit these dependencies and TypeScript settings from `workspace.toml`.

**packages/web/.project.toml**:

```toml
[package]
name = "web"

[package.devDependencies]
react = "^18.0.0" # Project-specific additional dependency
```

Result: `packages/web/package.json` has both workspace devDependencies AND the React dependency.

## Development

### Build

```bash
npm run build
```

Rebuilds `mutate-toml` (Rust → WASM) and bundles TypeScript → JavaScript using esbuild.

### Source Files

- `daemon/daemon.mts` — Main daemon loop and file registry
- `daemon/parse.mts` — TOML parsing and project discovery
- `daemon/write.mts` — File I/O and .gitignore management
- `daemon/diff.mts` — Deep diffing for TOML updates
- `daemon/mapping.mts` — "Lens" transformations (TOML ↔ JSON)
- `cli.mts` — Command-line interface
- `mutate-toml/` — Rust library (compiled to WASM)

### Testing

The daemon is tested by:

1. Creating a test workspace with `workspace.toml` and `.project.toml` files
2. Starting the daemon
3. Verifying generated files match expected output
4. Modifying generated JSON and verifying sync back to TOML

## Troubleshooting

### Daemon not starting

Check if a daemon is already running:

```bash
ps aux | grep "re" | grep -v grep
cat .re.pid  # Check the PID file
```

Kill any orphaned daemons and try again.

### Generated files not updating

1. Verify daemon is running: `re start`
2. Check console output for errors
3. Ensure TOML syntax is valid
4. Try `re generate` to test one-shot generation

### Changes not syncing back to TOML

Only certain files support sync (marked ✓ in the table above). TypeScript configs and some other files are read-only.

### .gitignore section growing

If re keeps adding lines to .gitignore, it's likely the file format changed. Re manages its section between markers:

```
# re: generated files
<list>
```

Manually fix the section if needed, or run `re clean && re generate` to rebuild.

## License

Part of the `caffeine-pub` monorepo.
