#!/usr/bin/env tsx

import { resolve } from "node:path";
import { startDaemon } from "./daemon.js";
import { parseWorkspaceToml, discoverProjects } from "./parse.js";
import { generateAll } from "./generate.js";
import { writeGeneratedFiles, ensureGitignore } from "./write.js";

const args = process.argv.slice(2);
const command = args[0];
const rootDir = resolve(".");

async function main() {
  switch (command) {
    case undefined:
    case "start": {
      // start daemon
      const { stop } = await startDaemon(rootDir);

      process.on("SIGINT", async () => {
        await stop();
        process.exit(0);
      });

      process.on("SIGTERM", async () => {
        await stop();
        process.exit(0);
      });

      break;
    }

    case "stop": {
      // TODO: send stop signal to running daemon via pidfile or socket
      console.log("re: stop not yet implemented (kill the process manually)");
      break;
    }

    case "generate": {
      const config = await parseWorkspaceToml(rootDir);
      const projects = await discoverProjects(rootDir, config);
      const files = generateAll(config, projects);
      const written = await writeGeneratedFiles(rootDir, files);

      await ensureGitignore(rootDir, [
        "pnpm-workspace.yaml",
        "pnpm-lock.yaml",
        ".npmrc",
        ".nvmrc",
        "tsconfig.base.json",
        "node_modules/",
        "**/package.json",
        "**/tsconfig.json",
      ]);

      console.log(`re: generated ${written.size} file${written.size === 1 ? "" : "s"}`);
      break;
    }

    case "clean": {
      // TODO: read generated file list and remove them
      console.log("re: clean not yet implemented");
      break;
    }

    case "run": {
      const task = args[1];
      const pkg = args[2];
      if (!task) {
        console.error("re: usage: re run <task> [pkg]");
        process.exit(1);
      }

      const config = await parseWorkspaceToml(rootDir);

      const script = config.scripts?.[task];
      if (!script) {
        console.error(`re: unknown task "${task}"`);
        console.error(`re: available tasks: ${Object.keys(config.scripts ?? {}).join(", ")}`);
        process.exit(1);
      }

      // run the script
      const { execSync } = await import("node:child_process");
      const cwd = pkg ? resolve(rootDir, pkg) : rootDir;
      console.log(`re: running "${script}" in ${pkg ?? "root"}`);
      execSync(script, { cwd, stdio: "inherit" });
      break;
    }

    default: {
      console.error(`re: unknown command "${command}"`);
      console.error("re: commands: start, stop, generate, clean, run <task> [pkg]");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("re:", err.message);
  process.exit(1);
});
