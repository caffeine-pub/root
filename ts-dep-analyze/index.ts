#!/usr/bin/env tsx

import { readdir, readFile } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";

const dir = process.argv[2] ?? ".";

interface ModuleNode {
  /** filename without extension */
  id: string;
  /** relative path */
  path: string;
  /** ids this module imports from */
  imports: Set<string>;
}

async function findTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter(e => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts"))
    .map(e => join(e.parentPath ?? e.path, e.name));
}

function extractImports(source: string): string[] {
  const imports: string[] = [];
  // match: import ... from "..." / import "..." / export ... from "..."
  const re = /(?:import|export)\s+(?:.*?\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    imports.push(m[1]);
  }
  return imports;
}

function resolveImportToId(
  importPath: string,
  fromFile: string,
  knownIds: Map<string, string>,
): string | null {
  // only handle relative imports
  if (!importPath.startsWith(".")) return null;

  // strip .js/.ts/.tsx extensions from the import
  const stripped = importPath.replace(/\.(js|ts|tsx)$/, "");
  const fromDir = join(fromFile, "..");
  const resolved = join(fromDir, stripped);

  // try to match against known files
  for (const [id, filePath] of knownIds) {
    const fileStripped = filePath.replace(/\.(ts|tsx)$/, "");
    if (resolved === fileStripped || resolved === join(fileStripped, "index")) {
      return id;
    }
  }

  return null;
}

async function analyze(dir: string): Promise<ModuleNode[]> {
  const files = await findTsFiles(dir);

  // build id map: "sync" -> "/abs/path/to/sync.ts"
  const knownIds = new Map<string, string>();
  for (const file of files) {
    const rel = relative(dir, file);
    const id = rel.replace(/\.(ts|tsx)$/, "").replace(/\\/g, "/");
    knownIds.set(id, file);
  }

  const nodes: ModuleNode[] = [];

  for (const [id, filePath] of knownIds) {
    const source = await readFile(filePath, "utf-8");
    const rawImports = extractImports(source);
    const imports = new Set<string>();

    for (const imp of rawImports) {
      const resolved = resolveImportToId(imp, filePath, knownIds);
      if (resolved && resolved !== id) {
        imports.add(resolved);
      }
    }

    nodes.push({ id, path: relative(dir, filePath), imports });
  }

  return nodes;
}

function toMermaid(nodes: ModuleNode[]): string {
  const lines: string[] = ["graph LR"];

  // find mutual (bidirectional) edges
  const mutual = new Set<string>();
  for (const node of nodes) {
    for (const dep of node.imports) {
      const other = nodes.find(n => n.id === dep);
      if (other?.imports.has(node.id)) {
        const key = [node.id, dep].sort().join("<>");
        mutual.add(key);
      }
    }
  }

  const emitted = new Set<string>();

  for (const node of nodes) {
    for (const dep of node.imports) {
      const mutualKey = [node.id, dep].sort().join("<>");
      if (mutual.has(mutualKey)) {
        if (!emitted.has(mutualKey)) {
          const [a, b] = mutualKey.split("<>");
          lines.push(`  ${a} <--> ${b}`);
          emitted.add(mutualKey);
        }
      } else {
        lines.push(`  ${node.id} --> ${dep}`);
      }
    }
  }

  // orphans (no imports and not imported by anyone)
  const allDeps = new Set(nodes.flatMap(n => [...n.imports]));
  for (const node of nodes) {
    if (node.imports.size === 0 && !allDeps.has(node.id)) {
      lines.push(`  ${node.id}`);
    }
  }

  return lines.join("\n") + "\n";
}

const out = process.argv[3] ?? "deps.md";
const nodes = await analyze(dir);
const md = "```mermaid\n" + toMermaid(nodes) + "```\n";
await import("node:fs/promises").then(fs => fs.writeFile(out, md));
console.log(`wrote ${out}`);
