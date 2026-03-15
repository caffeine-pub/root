/**
 * Generic deep diff between two plain JS values.
 * Produces a list of operations that, when applied to a TomlEditor,
 * transform the old value into the new value.
 */

export type DiffOp =
  | { type: "set"; path: string; value: string }
  | { type: "remove"; path: string }
  | { type: "insert_at"; path: string; index: number; value: string }
  | { type: "remove_at"; path: string; index: number };

/**
 * Convert a JS value to a TOML value string.
 * Strings get quoted, numbers/booleans are bare, etc.
 */
function toTomlValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(toTomlValue).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    // inline table
    const entries = Object.entries(value)
      .map(([k, v]) => `${k} = ${toTomlValue(v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return String(value);
}

/**
 * Quote a key segment if it contains dots or other characters
 * that would be misinterpreted as path separators by the toml editor.
 */
function quoteSegment(key: string): string {
  return key.includes(".") ? `"${key}"` : key;
}

function joinPath(prefix: string, key: string): string {
  const seg = quoteSegment(key);
  return prefix ? `${prefix}.${seg}` : seg;
}

/**
 * Deep diff two JS objects/values and emit operations.
 *
 * @param oldVal - the value currently represented in the TOML
 * @param newVal - the desired value
 * @param path - dot-separated path prefix (for recursion)
 */
export function deepDiff(
  oldVal: unknown,
  newVal: unknown,
  path: string = "",
): DiffOp[] {
  const ops: DiffOp[] = [];

  // same value — no diff
  if (oldVal === newVal) return ops;

  // both are plain objects — recurse
  if (
    typeof oldVal === "object" && oldVal !== null && !Array.isArray(oldVal) &&
    typeof newVal === "object" && newVal !== null && !Array.isArray(newVal)
  ) {
    const oldObj = oldVal as Record<string, unknown>;
    const newObj = newVal as Record<string, unknown>;

    // keys removed
    for (const key of Object.keys(oldObj)) {
      if (!(key in newObj)) {
        ops.push({ type: "remove", path: joinPath(path, key) });
      }
    }

    // keys added or changed
    for (const [key, val] of Object.entries(newObj)) {
      const childPath = joinPath(path, key);
      if (!(key in oldObj)) {
        ops.push({ type: "set", path: childPath, value: toTomlValue(val) });
      } else {
        ops.push(...deepDiff(oldObj[key], val, childPath));
      }
    }

    return ops;
  }

  // both are arrays — use LCS-style diffing for element insertions/removals
  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    return diffArrays(oldVal, newVal, path);
  }

  // type changed or scalar changed — set the whole thing
  ops.push({ type: "set", path, value: toTomlValue(newVal) });
  return ops;
}

/**
 * Diff two arrays. For simple scalar arrays (strings, numbers), we do
 * a proper minimal edit sequence. For arrays of objects, we fall back
 * to positional comparison.
 */
function diffArrays(oldArr: unknown[], newArr: unknown[], path: string): DiffOp[] {
  const ops: DiffOp[] = [];

  // simple case: both are scalar arrays — compute minimal insertions/removals
  if (isScalarArray(oldArr) && isScalarArray(newArr)) {
    return diffScalarArrays(oldArr, newArr, path);
  }

  // complex arrays (contain objects/arrays) — positional diff
  const maxLen = Math.max(oldArr.length, newArr.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= newArr.length) {
      // element removed — but we need to remove from the end to avoid index shift
      // so collect removals and emit in reverse
      for (let j = oldArr.length - 1; j >= newArr.length; j--) {
        ops.push({ type: "remove_at", path, index: j });
      }
      break;
    } else if (i >= oldArr.length) {
      ops.push({ type: "insert_at", path, index: i, value: toTomlValue(newArr[i]) });
    } else {
      // both exist — if they differ, set the whole element
      const childOps = deepDiff(oldArr[i], newArr[i], `${path}[${i}]`);
      ops.push(...childOps);
    }
  }

  return ops;
}

function isScalarArray(arr: unknown[]): arr is (string | number | boolean)[] {
  return arr.every(v => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
}

/**
 * Diff two scalar arrays using a simple set-difference approach:
 * find elements to remove (in old but not new) and elements to add (in new but not old).
 * Removals are emitted in reverse index order to preserve indices.
 * Insertions are appended at the end.
 */
function diffScalarArrays(
  oldArr: (string | number | boolean)[],
  newArr: (string | number | boolean)[],
  path: string,
): DiffOp[] {
  const ops: DiffOp[] = [];

  const oldSet = new Set(oldArr.map(String));
  const newSet = new Set(newArr.map(String));

  // removals — reverse order to preserve indices
  for (let i = oldArr.length - 1; i >= 0; i--) {
    if (!newSet.has(String(oldArr[i]))) {
      ops.push({ type: "remove_at", path, index: i });
    }
  }

  // insertions — append at end
  for (const val of newArr) {
    if (!oldSet.has(String(val))) {
      ops.push({ type: "insert_at", path, index: newArr.length, value: toTomlValue(val) });
    }
  }

  return ops;
}
