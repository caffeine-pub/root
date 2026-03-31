import type { FunctionExpr, Program } from "./ast.js";
import type { PlaceId } from "./arenas.js";
import type { Constraint, PossibleValues } from "./kleene.js";

/**
 * An instantiation of a function at a particular call site.
 * Two instantiations are "equal" when they have the same expr
 * and the same args (by reference).
 */
export class Instantiation {
  constructor(
    public expr: FunctionExpr,
    public args: PossibleValues[],
    public rewrite: Map<PlaceId, PlaceId>,
    public constraints: Constraint[],
    public params: PlaceId[],
    public returnVar: PlaceId,
    public hash: string,
  ) {}
}

export type GraphNode = Instantiation | Program;

function nodesEqual(a: GraphNode, b: GraphNode): boolean {
  if (a === b) return true;
  if (a instanceof Instantiation && b instanceof Instantiation) {
    if (a.expr !== b.expr) return false;
    if (a.args.length !== b.args.length) return false;
    for (let i = 0; i < a.args.length; i++) {
      if (!a.args[i].eq(b.args[i])) return false;
    }
    return true;
  }
  return false;
}

/** Linear-scan set with custom equality */
class NodeSet {
  private items: GraphNode[] = [];

  has(node: GraphNode): boolean {
    for (const item of this.items) {
      if (nodesEqual(item, node)) return true;
    }
    return false;
  }

  /** Returns true if the node was newly added */
  add(node: GraphNode): boolean {
    if (this.has(node)) return false;
    this.items.push(node);
    return true;
  }

  delete(node: GraphNode): boolean {
    for (let i = 0; i < this.items.length; i++) {
      if (nodesEqual(this.items[i], node)) {
        this.items.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  get size(): number {
    return this.items.length;
  }

  [Symbol.iterator](): Iterator<GraphNode> {
    return this.items[Symbol.iterator]();
  }
}

/** Linear-scan map with custom equality on keys */
class NodeMap<V> {
  private entries: [GraphNode, V][] = [];

  get(key: GraphNode): V | undefined {
    for (const [k, v] of this.entries) {
      if (nodesEqual(k, key)) return v;
    }
    return undefined;
  }

  set(key: GraphNode, value: V): void {
    for (const entry of this.entries) {
      if (nodesEqual(entry[0], key)) {
        entry[1] = value;
        return;
      }
    }
    this.entries.push([key, value]);
  }

  has(key: GraphNode): boolean {
    for (const [k] of this.entries) {
      if (nodesEqual(k, key)) return true;
    }
    return false;
  }

  *keys(): IterableIterator<GraphNode> {
    for (const [k] of this.entries) yield k;
  }

  *values(): IterableIterator<V> {
    for (const [, v] of this.entries) yield v;
  }

  *[Symbol.iterator](): IterableIterator<[GraphNode, V]> {
    for (const entry of this.entries) yield entry;
  }
}

export class CallGraph {
  private _edges = new NodeMap<NodeSet>();
  private _dirty = false;

  /**
   * Add a call edge: caller may invoke target.
   * Sets dirty if the edge is new.
   */
  addEdge(caller: GraphNode, target: Instantiation): void {
    let targets = this._edges.get(caller);
    if (!targets) {
      targets = new NodeSet();
      this._edges.set(caller, targets);
    }
    if (targets.add(target)) {
      this._dirty = true;
    }
  }

  /**
   * Get all known callees of a node.
   */
  callees(node: GraphNode): NodeSet | undefined {
    return this._edges.get(node);
  }

  get dirty(): boolean {
    return this._dirty;
  }

  clearDirty(): void {
    this._dirty = false;
  }

  /**
   * Returns SCCs of graph nodes in reverse topological order.
   * Leaf nodes (no outgoing calls) come first.
   */
  sccs(): GraphNode[][] {
    const allNodes = new NodeSet();
    for (const [caller, targets] of this._edges) {
      allNodes.add(caller);
      for (const target of targets) {
        allNodes.add(target);
      }
    }
    return tarjan(allNodes, this._edges);
  }
}

function tarjan(nodes: NodeSet, successors: NodeMap<NodeSet>): GraphNode[][] {
  let index = 0;
  // Use arrays of [node, value] since we need custom equality
  const indices: [GraphNode, number][] = [];
  const lowlinks: [GraphNode, number][] = [];
  const onStack = new NodeSet();
  const stack: GraphNode[] = [];
  const result: GraphNode[][] = [];

  function getIndex(v: GraphNode): number | undefined {
    for (const [n, i] of indices) {
      if (nodesEqual(n, v)) return i;
    }
    return undefined;
  }

  function setIndex(v: GraphNode, val: number): void {
    for (const entry of indices) {
      if (nodesEqual(entry[0], v)) {
        entry[1] = val;
        return;
      }
    }
    indices.push([v, val]);
  }

  function getLowlink(v: GraphNode): number {
    for (const [n, i] of lowlinks) {
      if (nodesEqual(n, v)) return i;
    }
    return -1;
  }

  function setLowlink(v: GraphNode, val: number): void {
    for (const entry of lowlinks) {
      if (nodesEqual(entry[0], v)) {
        entry[1] = val;
        return;
      }
    }
    lowlinks.push([v, val]);
  }

  function strongconnect(v: GraphNode) {
    setIndex(v, index);
    setLowlink(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const succs = successors.get(v);
    if (succs) {
      for (const w of succs) {
        if (getIndex(w) === undefined) {
          strongconnect(w);
          setLowlink(v, Math.min(getLowlink(v), getLowlink(w)));
        } else if (onStack.has(w)) {
          setLowlink(v, Math.min(getLowlink(v), getIndex(w)!));
        }
      }
    }

    if (getLowlink(v) === getIndex(v)) {
      const scc: GraphNode[] = [];
      let w: GraphNode;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (!nodesEqual(w, v));
      result.push(scc);
    }
  }

  for (const node of nodes) {
    if (getIndex(node) === undefined) {
      strongconnect(node);
    }
  }

  return result;
}
