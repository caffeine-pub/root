/** @hash */
export interface User {
  name: string;
  age: number;
  email: string;
}

/** @hash */
export interface Point {
  x: number;
  y: number;
}

/** @hash */
export type Status = "active" | "inactive" | "banned";

/** @hash */
export interface WithOptional {
  required: string;
  optional?: number;
}

/** @hash */
export interface Nested {
  point: Point;
  label: string;
}

/** @hash */
export interface WithArray {
  items: string[];
  counts: number[];
}

/** @hash */
export interface WithTuple {
  pair: [string, number];
}

/** @hash */
export interface Recursive {
  value: number;
  children: Recursive[];
}

// NOT tagged — should be ignored
export interface Ignored {
  foo: string;
}

/** @hash */
export type Union = { kind: "circle"; radius: number } | { kind: "rect"; width: number; height: number };

/** @hash */
export interface WithBigInt {
  id: bigint;
}

/** @hash */
export interface WithBoolean {
  flag: boolean;
}

/** @hash */
export interface WithNull {
  value: string | null;
}

/** @hash */
export interface Box<T> {
  value: T;
}

/** @hash */
export interface Pair<A, B> {
  first: A;
  second: B;
}

/** @hash */
export interface Container<T> {
  items: T[];
  label: string;
}

/** @hash */
export interface Constrained<T extends { hash(h: any): void }> {
  value: T;
}

/** @hash */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** @hash */
export class GenericClass<T> {
  constructor(public value: T, public label: string) {}
}

/** @hash */
export interface StringMap {
  [key: string]: number;
}

/** @hash */
export interface NumberMap {
  [key: number]: string;
}

/** @hash */
export interface MixedIndex {
  name: string;
  [key: string]: string | number;
}

/** @hash */
export type UserRecord = Record<string, number>;

/** @hash */
export type PickedUser = Pick<User, "name" | "age">;

/** @hash */
export type ReadonlyPoint = Readonly<Point>;

/** @hash */
export type UserWithExtra = User & { id: string; extra: number };

/** @hash */
export interface WithDate {
  created: Date;
}

/** @hash */
export interface WithMap {
  scores: Map<string, number>;
}

/** @hash */
export interface WithSet {
  tags: Set<string>;
}

/** @hash */
export type DateOrNumber = Date | number;

/** @hash */
export type MapOrObject = Map<string, number> | { [key: string]: number };

/** @hash */
export type SetOrArray = Set<string> | string[];
