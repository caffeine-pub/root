export const WORKSPACE_TOML = "workspace.toml";
export const PROJECT_TOML = ".project.toml";

export const RE_PID = ".re.pid";
export const GITIGNORE = ".gitignore";
export const NPMRC = ".npmrc";
export const NVMRC = ".nvmrc";
export const PRETTIERRC = ".prettierrc";
export const PNPM_WORKSPACE = "pnpm-workspace.yaml";
export const PNPM_LOCK = "pnpm-lock.yaml";
export const TSCONFIG = "tsconfig.json";
export const TSBUILDINFO = "*.tsbuildinfo";

export const VSCODE = ".vscode";
export const SETTINGS_JSON = "settings.json";
export const SETTINGS_LOCAL_JSON = "settings.local.json";
export const PACKAGE_JSON = "package.json";

export const GITIGNORE_LIST = [
  "node_modules/",
  RE_PID,
  PACKAGE_JSON,
  TSCONFIG,
  TSBUILDINFO,
  PNPM_WORKSPACE,
  PNPM_LOCK,
  NPMRC,
  NVMRC,
  PRETTIERRC,
  `${VSCODE}/${SETTINGS_JSON}`,
  `${VSCODE}/${SETTINGS_LOCAL_JSON}`,
];

export const FILEIGNORE_LIST = (isSettingsJsonOnlyFileInVscode: boolean) => [
  RE_PID,
  `**/${PACKAGE_JSON}`,
  `**/${TSCONFIG}`,
  `**/${TSBUILDINFO}`,
  PNPM_WORKSPACE,
  PNPM_LOCK,
  NPMRC,
  NVMRC,
  PRETTIERRC,
  // isSettingsJsonOnlyFileInVscode ? VSCODE : `${VSCODE}/${SETTINGS_JSON}`,
  // wait for vscode#291047
];
