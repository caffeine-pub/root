import type { FunctionExpr, Program } from "./ast.js";

export type FunctionNode = FunctionExpr | Program;

export class CallGraph {
  private _edges = new Map<FunctionNode, Set<FunctionNode>>();
  private _dirty = false;

  /**
   * Add a call edge: caller may invoke target.
   * Sets dirty if the edge is new.
   */
  addEdge(caller: FunctionNode, target: FunctionExpr): void {
    let targets = this._edges.get(caller);
    if (!targets) {
      targets = new Set();
      this._edges.set(caller, targets);
    }
    const before = targets.size;
    targets.add(target);
    if (targets.size > before) {
      this._dirty = true;
    }
  }

  /**
   * Get all known callees of a function node.
   */
  callees(node: FunctionNode): Set<FunctionNode> | undefined {
    return this._edges.get(node);
  }

  get dirty(): boolean {
    return this._dirty;
  }

  clearDirty(): void {
    this._dirty = false;
  }

  /**
   * Returns SCCs of function nodes in reverse topological order.
   * Leaf functions (no outgoing calls) come first.
   */
  sccs(): FunctionNode[][] {
    const allNodes = new Set<FunctionNode>();
    for (const [caller, targets] of this._edges) {
      allNodes.add(caller);
      for (const target of targets) {
        allNodes.add(target);
      }
    }
    return tarjan(allNodes, this._edges);
  }
}

function tarjan<T>(
  nodes: Set<T>,
  successors: Map<T, Set<T>>,
): T[][] {
  let index = 0;
  const indices = new Map<T, number>();
  const lowlinks = new Map<T, number>();
  const onStack = new Set<T>();
  const stack: T[] = [];
  const result: T[][] = [];

  function strongconnect(v: T) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const succs = successors.get(v);
    if (succs) {
      for (const w of succs) {
        if (!indices.has(w)) {
          strongconnect(w);
          lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
        } else if (onStack.has(w)) {
          lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
        }
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: T[] = [];
      let w: T;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      result.push(scc);
    }
  }

  for (const node of nodes) {
    if (!indices.has(node)) {
      strongconnect(node);
    }
  }

  return result;
}
