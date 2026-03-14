# re

a bidirectional monorepo config tool. `workspace.toml` + `project.toml`, everything else is derived.

## how it works

`re` watches your `workspace.toml` and `project.toml` files, generates the config files your tools expect — `package.json`, `tsconfig.json`, `pnpm-workspace.yaml`, etc. when those generated files change (e.g. `pnpm add` modifies a `package.json`), `re` syncs the change back into the appropriate toml file.

all generated files are gitignored. your repo on github is just source code and toml files.

packages are discovered automatically — any directory with a `project.toml` is a package.

## daemon

```sh
re              # start the daemon (watches toml files + generated files)
re stop         # stop the daemon
```

any other command starts the daemon implicitly if it isn't running.

## commands

```sh
re generate     # one-shot: generate all config files and exit
re clean        # remove all generated files
re add <pkg> <dep>          # add a dependency to a package
re add <pkg> <dep> --dev    # add a dev dependency
re remove <pkg> <dep>       # remove a dependency
re run <task>               # run a task defined in workspace.toml
re run <task> <pkg>         # run a task scoped to a package
re audit                    # check dependencies for known vulnerabilities
re outdated                 # list outdated dependencies
```

## workspace.toml

lives at the repo root. defines workspace-level config that packages inherit from.

```toml
# by default, only subdirectories with project.toml are considered
projects = ["*"]

[scripts]
dev = "tsc --watch"
build = "tsc --build"
test = "vitest run"

[engines]
node = "22.0.0"
pnpm = "10.20.0"

[workspace]
name = "caffeine"
version = "0.1.0"
type = "module"

[workspace.dependencies]
typescript = "5.7.0"  

[workspace.devDependencies]
tsx = "4.19.0"
"@types/node" = "22.0.0"

[tsconfig.compilerOptions]
strict = true
module = "Node16"
moduleResolution = "Node16"
esModuleInterop = true
skipLibCheck = true

[prettier]
printWidth = 100
tabWidth = 2
useTabs = false
```

## project.toml

lives in each package directory. overrides/extends workspace config.

**caffeinec/project.toml**
```toml
# notice it's not [workspace], which gets inherited. this means you don't necessarily need a project.toml in these directories
[package]
name = "caffeinec"

[package.dependencies]
smol-toml = "1.3.1"

[tsconfig.compilerOptions]
target = "ES2024"
```

**caffeine-daemon/project.toml**
```toml
[package]
name = "caffeine-daemon"

[package.dependencies]
caffeinec = "workspace:*"
caffeine-common = "workspace:*"
```

**site/project.toml**
```toml
[package]
name = "site"
```


## what gets generated

**pnpm-workspace.yaml** (auto-discovered from project.toml files)
```yaml
packages:
  - caffeinec
  - caffeine-daemon
  - site
```

**caffeinec/package.json** (merged: workspace.toml + caffeinec/project.toml)
```json
{
  "name": "caffeinec",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "typescript": "5.7.0",
    "smol-toml": "1.3.1"
  },
  "devDependencies": {
    "tsx": "4.19.0",
    "@types/node": "22.0.0"
  }
}
```

**caffeinec/tsconfig.json**
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2024",
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**tsconfig.base.json** (root, from workspace.toml)
```json
{
  "compilerOptions": {
    "strict": true,
    "module": "Node16",
    "moduleResolution": "Node16",
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

**.nvmrc** (from `[engines]`)
```
22.0.0
```

**root package.json** (includes volta + engines + corepack)
```json
{
  "name": "caffeine",
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": "22.0.0",
    "pnpm": "10.20.0"
  },
  "packageManager": "pnpm@10.20.0",
  "volta": {
    "node": "22.0.0"
  }
}
```

**.npmrc**
```
save-prefix=
```

**.gitignore** (appended)
```
# re: generated files
pnpm-workspace.yaml
pnpm-lock.yaml
.npmrc
tsconfig.base.json
node_modules/
**/package.json
**/tsconfig.json
```

## bidirectional sync

when `re` is running and you do:

```sh
cd caffeinec && pnpm add zod
```

pnpm modifies `caffeinec/package.json`. `re` detects the change, parses the new package.json, sees `zod` was added, and updates `caffeinec/project.toml`:

```toml
[package.dependencies]
smol-toml = "1.3.1"
zod = "3.24.0"
```

then re-generates all config files from the updated toml (formatted with prettier + prettier-plugin-toml).

if the reverse change is invalid (e.g. malformed JSON), `re` ignores it and regenerates from the toml, overwriting the bad edit.

dependencies are always pinned to exact versions. no `^`, no `~`.

## what your repo looks like on github

```
caffeinec/
  project.toml
  src/
caffeine-daemon/
  project.toml
  src/
site/
  project.toml
  src/
workspace.toml
```

that's it.
