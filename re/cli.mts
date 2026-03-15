#!/usr/bin/env tsx

import { resolve, join } from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { spawn, execSync } from "node:child_process";
import { startDaemon, generateAll } from "./daemon/daemon.mjs";
import { parseWorkspaceToml, discoverProjects } from "./daemon/parse.mjs";
import { writeGeneratedFiles, ensureGitignore } from "./daemon/write.mjs";
import * as Paths from "./paths.mjs";

const rootDir = resolve(".");
const pidFile = join(rootDir, ".re.pid");

async function readPid(): Promise<number | null> {
  try {
    const pid = parseInt(await readFile(pidFile, "utf-8"), 10);
    process.kill(pid, 0);
    return pid;
  } catch {
    try { await unlink(pidFile); } catch {}
    return null;
  }
}

// fast path: we're the detached daemon child
if (process.env.RE_DAEMON) {
  const { stop } = await startDaemon(rootDir);

  const cleanup = async () => {
    await stop();
    try { await unlink(pidFile); } catch {}
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
} else {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case undefined:
    case "start": {
      const existing = await readPid();
      if (existing) {
        console.log(`re: daemon already running (pid ${existing})`);
        process.exit(0);
      }

      const child = spawn(
        process.execPath,
        [...process.execArgv, import.meta.filename],
        {
          cwd: rootDir,
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
          env: { ...process.env, RE_DAEMON: "1" },
        },
      );

      await writeFile(pidFile, String(child.pid));
      child.unref();

      console.log(`re: daemon started (pid ${child.pid})`);
      process.exit(0);
    }

    case "stop": {
      const pid = await readPid();
      if (!pid) {
        console.log("re: no daemon running");
        process.exit(0);
      }

      process.kill(pid, "SIGTERM");
      try { await unlink(pidFile); } catch {}
      console.log(`re: daemon stopped (pid ${pid})`);
      process.exit(0);
    }

    case "generate": {
      const config = await parseWorkspaceToml(rootDir);
      const projects = await discoverProjects(rootDir, config);
      const workspace = { dir: rootDir, config };
      const files = await generateAll(rootDir, workspace, projects);
      const written = await writeGeneratedFiles(rootDir, files);

      await ensureGitignore(rootDir, Paths.GITIGNORE_LIST);

      console.log(`re: generated ${written.size} file${written.size === 1 ? "" : "s"}`);
      break;
    }

    case "clean": {
      const config = await parseWorkspaceToml(rootDir);
      const projects = await discoverProjects(rootDir, config);
      const workspace = { dir: rootDir, config };
      const files = await generateAll(rootDir, workspace, projects);

      let removed = 0;
      for (const relPath of files.keys()) {
        try {
          await unlink(join(rootDir, relPath));
          removed++;
        } catch {}
      }

      console.log(`re: removed ${removed} file${removed === 1 ? "" : "s"}`);
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
