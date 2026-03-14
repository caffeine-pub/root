import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

/**
 * Write all generated files to disk.
 * Tracks which files were written so the watcher can ignore self-triggered changes.
 *
 * Returns the set of absolute paths that were written.
 */
export async function writeGeneratedFiles(
  rootDir: string,
  files: Map<string, string>,
): Promise<Set<string>> {
  const written = new Set<string>();

  for (const [relativePath, content] of files) {
    const absPath = join(rootDir, relativePath);
    const dir = dirname(absPath);

    // ensure directory exists
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // skip write if content hasn't changed (avoids triggering watcher loops)
    if (existsSync(absPath)) {
      try {
        const existing = await readFile(absPath, "utf-8");
        if (existing === content) continue;
      } catch {
        // file exists but can't read — write anyway
      }
    }

    await writeFile(absPath, content);
    written.add(absPath);
  }

  return written;
}

/**
 * Append re's managed entries to .gitignore if they aren't already there.
 */
export async function ensureGitignore(rootDir: string, generatedPaths: string[]): Promise<void> {
  const gitignorePath = join(rootDir, ".gitignore");
  const marker = "# re: generated files";

  let existing = "";
  if (existsSync(gitignorePath)) {
    existing = await readFile(gitignorePath, "utf-8");
  }

  // if our section already exists, replace it
  if (existing.includes(marker)) {
    const before = existing.slice(0, existing.indexOf(marker));
    const section = buildGitignoreSection(marker, generatedPaths);
    await writeFile(gitignorePath, before.trimEnd() + "\n\n" + section + "\n");
    return;
  }

  // otherwise append
  const section = buildGitignoreSection(marker, generatedPaths);
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
  await writeFile(gitignorePath, existing + separator + section + "\n");
}

function buildGitignoreSection(marker: string, paths: string[]): string {
  return [marker, ...paths].join("\n");
}
