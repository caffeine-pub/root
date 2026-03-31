import { Arena, type Id, type Poolable } from "ts-arena";
import type { Program, Stmt } from "./ast.js";

export type Owner = FunctionExpr | Program;

// ---- FunctionExpr ----

export type FunctionExprId = Id<"FunctionExpr">;

export class FunctionExpr {
  kind = "function"; // never changes

  id!: FunctionExprId;
  params!: string[];
  body!: Stmt[];
  line!: number;
  label!: string;

  create(
    id: FunctionExprId,
    params: string[],
    body: Stmt[],
    line: number,
    label: string,
  ) {
    this.id = id;
    this.params = params;
    this.body = body;
    this.line = line;
    this.label = label;
  }

  hash() {
    return this.id.toString();
  }
}

export const functions = new Arena<FunctionExprId, FunctionExpr>(FunctionExpr);

// ---- Place ----

export type PlaceId = Id<"Place">;

export class Place implements Poolable<PlaceId, [string, Owner]> {
  id!: PlaceId;
  name!: string;
  owner!: Owner;
  create(id: PlaceId, name: string, owner: Owner) {
    this.id = id;
    this.name = name;
    this.owner = owner;
  }
}

export const places = new Arena<PlaceId, Place>(Place);

// ---- AbstractObject ----

export type AbstractObjectId = Id<"AbstractObject">;

export class AbstractObject
  implements Poolable<AbstractObjectId, [string, Owner]>
{
  id!: AbstractObjectId;
  name!: string;
  owner!: Owner;
  fields!: Map<string, PlaceId>;
  create(id: AbstractObjectId, name: string, owner: Owner) {
    this.id = id;
    this.name = name;
    this.owner = owner;
    this.fields = new Map();
  }
}

export const objects = new Arena<AbstractObjectId, AbstractObject>(
  AbstractObject,
);

// ---- Helpers ----

export function objectField(objId: AbstractObjectId, index: string): PlaceId {
  const obj = objects.get(objId);
  const exists = obj.fields.get(index);
  if (exists !== undefined) return exists;
  const place = places.alloc(`${obj.name}.${index}`, obj.owner);
  obj.fields.set(index, place);
  return place;
}

export function cloneObject(
  objId: AbstractObjectId,
  lookup: (p: PlaceId) => PlaceId,
  newOwner: Owner,
): AbstractObjectId {
  const obj = objects.get(objId);
  const newId = objects.alloc(`${obj.name}_instant`, newOwner);
  const newObj = objects.get(newId);

  for (const [name, placeId] of obj.fields) {
    newObj.fields.set(name, lookup(placeId));
  }

  return newId;
}
