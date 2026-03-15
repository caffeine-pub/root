import * as Paths from "../paths.mjs";

export interface Warning {
  file: string;
  path: string;
  message: string;
}

const RANGE_CHARS = /[~^><=|x*\s]/;

function isVersionRange(version: string): boolean {
  return RANGE_CHARS.test(version);
}

function checkDeps(
  deps: Record<string, string> | undefined,
  file: string,
  section: string,
): Warning[] {
  if (!deps) return [];
  const warnings: Warning[] = [];
  for (const [name, version] of Object.entries(deps)) {
    if (isVersionRange(version)) {
      warnings.push({
        file,
        path: `${section}.${name}`,
        message: `use an exact version instead (version range "${version})"`,
      });
    }
  }
  return warnings;
}

export function validate(
  workspace: ResolvedWorkspace,
  projects: ResolvedProject[],
): Warning[] {
  const warnings: Warning[] = [];

  // workspace.toml deps
  warnings.push(
    ...checkDeps(workspace.config.workspace?.dependencies, Paths.WORKSPACE_TOML, "workspace.dependencies"),
    ...checkDeps(workspace.config.workspace?.devDependencies, Paths.WORKSPACE_TOML, "workspace.devDependencies"),
  );

  // project deps
  for (const project of projects) {
    if (!project.hasProjectToml) continue;
    const file = `${project.dir}/${Paths.PROJECT_TOML}`;
    warnings.push(
      ...checkDeps(project.config.package?.dependencies, file, "package.dependencies"),
      ...checkDeps(project.config.package?.devDependencies, file, "package.devDependencies"),
    );
  }

  return warnings;
}
