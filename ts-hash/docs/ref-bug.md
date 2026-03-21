# The `ref` name resolution bug

## What refs are for

When the walker encounters a recursive type, it needs to stop expanding at some point or it'll loop forever. The `seen` set tracks type IDs — if we encounter a type ID we're already in the middle of walking, we emit a `ref` node instead of expanding further:

```ts
// walker.ts, line 218
if (seen.has(typeId)) {
  const symbol = type.getSymbol();
  return { kind: "ref", name: symbol?.getName() ?? `<recursive:${typeId}>` };
}
```

The codegen then turns refs into recursive function calls:

```ts
// codegen.ts
case "ref":
  lines.push(`${indent}_hash${node.name}(h, ${accessor});`);
```

So `{ kind: "ref", name: "LinkedList" }` becomes `_hashLinkedList(h, value.next)`.

## The bug

When TS resolves a generic type alias like `LinkedList<T>`, the underlying type is an **anonymous object type** — not the named alias. The alias is just sugar. Under the hood:

```
LinkedList<T> = { value: T; next: LinkedList<T> | null }
```

TS creates an object type with symbol name `__type` (the internal name for anonymous object types). When you write `LinkedList<T>` the type checker resolves through the alias and gives you this anonymous object type directly.

For a **self-referential** type like `LinkedList<T>`, here's what happens:

1. Walker sees the top-level type for `LinkedList`. TS gives us an anonymous object type (symbol: `__type`, id: say 42).
2. Walker adds id 42 to `seen`, starts walking properties.
3. Walker hits `next: LinkedList<T> | null`. The union member `LinkedList<T>` resolves to... the same anonymous object type (id 42).
4. `seen.has(42)` is true → emit `{ kind: "ref", name: "__type" }`.

The name is `__type` because `type.getSymbol()?.getName()` returns the anonymous object's symbol name, not the alias name. 

In the codegen output this produces:

```ts
type LinkedList<T> = { next: null | __type; value: T };
//                                  ^^^^^^ wrong

export function _hashLinkedList<T>(h: Hasher, value: ...) {
  _hash__type(h, value.next);
  // ^^^^^^^^^^^ doesn't exist
}
```

## Why it works for the simple case anyway

When you only have one `@hash` type that's self-recursive:

```ts
/** @hash */
type LinkedList<T> = { value: T; next: LinkedList<T> | null };
```

The walker output is:

```
name: "LinkedList"
node: { kind: "object", properties: [
  { name: "next", type: { kind: "union", members: [null, ref("__type")] } },
  { name: "value", type: typeParameter("T") }
]}
```

The codegen collects all `ref` names and looks them up in the target list by name. `__type` doesn't match `LinkedList`, so **no type alias is emitted for it** and **no helper function is generated**. The generated code calls `_hash__type()` which doesn't exist. This is a compile error in the output.

Right now our test suite doesn't catch this because the codegen tests use hand-crafted TypeNode trees where we write `ref("LinkedList")` directly, bypassing the walker.

## The cross-type case

It gets worse with multiple types:

```ts
/** @hash */
type LinkedList<T> = { value: T; next: LinkedList<T> | null };

/** @hash */
type Wrapper = { inner: LinkedList<string> };
```

The walker produces for `Wrapper`:

```
name: "Wrapper"
node: { kind: "object", properties: [
  { name: "inner", type: { kind: "object", properties: [
    { name: "next", type: union[null, ref("__type")] },
    { name: "value", type: string }   // <-- correctly resolved! T → string
  ]}}
]}
```

Notice: `value` is correctly `string` (not `typeParameter("T")`). The TS type checker resolved `LinkedList<string>` and substituted `T → string` before the walker saw it. The walker is working with the **instantiated** type.

But the ref is still `__type`. And the codegen calls `_hash__type()` which doesn't exist.

**Importantly**: the hash *logic* would be correct if the ref resolved properly. The structural walk already has the right types. It's only the ref name that's wrong.

## What about `Box<T>` becoming `Box<string[]>`?

This was the originally suspected bug — that the codegen would emit `Box<T>` where it should emit `Box<string[]>`. This **doesn't happen** because:

1. The walker uses `checker.getTypeOfSymbol(prop)` to get property types, which returns the **instantiated** type. `LinkedList<string>.value` comes back as `string`, not as `typeParameter("T")`.

2. The generic substitution happens inside the TS type checker, before our walker sees anything. We never see an unsubstituted `T` in a concrete instantiation context.

3. The `refTypeParams` map in codegen (which appends `<T>` to ref names) only fires for type annotation emission, not for the hash logic. And it looks up by ref name — `__type` isn't in the map, so it emits bare `__type`.

So the type argument issue is a red herring. The real bug is just: **the ref name is `__type` instead of the alias name**.

## The fix

The walker needs to resolve the alias name when emitting a ref. When `seen.has(typeId)` fires, instead of just `type.getSymbol()?.getName()`, we need to find the type alias declaration that this type came from.

Option A: Walk up the alias chain. TS has `checker.typeToString(type)` which returns the alias name, but it also includes type arguments (e.g. `LinkedList<string>`) and we'd need to parse that.

Option B: When we first encounter a type alias declaration in `extractHashTargets`, record the mapping from the anonymous object type's ID to the alias name. Then when the recursion guard fires, look up the ID in that mapping.

Option C: Change the `ref` node to carry the type ID instead of a name, and resolve names at codegen time using the target list.

Option B is probably cleanest. Before walking each target, record `typeId → targetName`. Then in the recursion guard:

```ts
if (seen.has(typeId)) {
  // Try our alias map first, fall back to symbol name
  const aliasName = aliasMap.get(typeId);
  const name = aliasName ?? type.getSymbol()?.getName() ?? `<recursive:${typeId}>`;
  return { kind: "ref", name };
}
```

But this only handles self-referential `@hash` types. For the cross-type case (`Wrapper` referencing `LinkedList<string>`), the instantiated `LinkedList<string>` has a **different type ID** from the parametric `LinkedList<T>`. So the alias map built from `@hash` declarations wouldn't have it.

For cross-type, we'd need to also check `type.aliasSymbol` — TS tracks the originating alias even on instantiated types:

```ts
if (seen.has(typeId)) {
  const aliasName = type.aliasSymbol?.getName();
  const name = aliasName ?? aliasMap.get(typeId) ?? type.getSymbol()?.getName() ?? `<recursive:${typeId}>`;
  return { kind: "ref", name };
}
```

`type.aliasSymbol` is the original type alias symbol before instantiation. This should give us `"LinkedList"` even for the instantiated `LinkedList<string>` type.

## Fix (applied)

Two changes:

**Walker**: use `type.aliasSymbol?.getName()` instead of `type.getSymbol()?.getName()` in the recursion guard. Also extract `type.aliasTypeArguments` and store them as `typeArguments` on the ref node — these are the instantiated type args (e.g. `[string]` for `LinkedList<string>`).

**Codegen**: in `emitTypeAnnotation` for `ref` nodes, prefer `node.typeArguments` (from walker) over `refTypeParams` (from declaration). So a ref with `typeArguments: [string]` emits `LinkedList<string>`, while a ref without type arguments (self-recursive case) falls back to the declaration's params and emits `LinkedList<T>`.

Note: we walk `aliasTypeArguments` with a **fresh** `seen` set (not the current one). The type arguments are independent types (e.g. `string`) that aren't part of the current recursion chain — using the parent's `seen` set could incorrectly mark them as recursive.
