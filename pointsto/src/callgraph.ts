import { HashSet } from "ts-hash";
import type { CallExpr, FunctionExpr } from "./ast.js";

/**
 * A call site is identified by its line number.
 * Maps call sites to the set of functions they may invoke.
 */
export class CallGraph {
  private _edges = new Map<CallExpr, HashSet<FunctionExpr>>();
  private _dirty = false;

  private _hashFn = (fn: FunctionExpr) => `fn@${fn.line}`;

  /**
   * Add a call edge: the call site may invoke this function.
   * Sets dirty if the edge is new.
   */
  addEdge(call: CallExpr, target: FunctionExpr): void {
    let targets = this._edges.get(call);
    if (!targets) {
      targets = new HashSet(this._hashFn);
      this._edges.set(call, targets);
    }
    if (targets.add(target)) {
      this._dirty = true;
    }
  }

  /**
   * Get all known targets for a call site.
   */
  targets(call: CallExpr): HashSet<FunctionExpr> | undefined {
    return this._edges.get(call);
  }

  get dirty(): boolean {
    return this._dirty;
  }

  clearDirty(): void {
    this._dirty = false;
  }
}
