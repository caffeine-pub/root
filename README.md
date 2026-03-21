# caffeine

bespoke actor framework for javascript with borrow checking

## what

you know how react is single-threaded and everyone pretends web workers don't exist? and you know how rust has a borrow checker and javascript has... not a particularly good gc?

we're fixing both of those problems by creating new problems.

caffeine is two things:

1. a language (`.ine` files) with actors and "borrow checking" that compiles to typescript
2. a runtime actor library that runs in webworkers

everything is an actor. actors send messages. the type system tracks borrows (handles) so you don't spawn a million actors and leak memory. the resource analysis here is a bit more flexible than rust's borrow checking since we allow structs to own each other

## why borrow checking?

javascript's garbage collector only works within a single thread. when you spawn an actor on a web worker, the actor lives in the worker's memory, but you hold a handle (just a pid, a number like `42`) on the main thread.

```ts
const owned handle = await MyActor {}.start(); // handle = 42, actor lives on worker

// ... later, handle goes out of scope, never escapes
// the actual actor on the worker is still allocated. leaked forever.
```

the gc has no idea that `42` represents an actor somewhere else. it just sees a number. when the number gets collected, nothing happens to the actor. there's no cross-thread gc in javascript.

so you need to manually track when handles are no longer reachable and send explicit kill messages. borrow checking does this statically at compile time. the compiler knows when ownership ends and inserts `drop()` calls automatically.

## [`FinalizationRegistry`?](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)

we do not use `FinalizationRegistry` because [it is not reliable enough](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry#notes_on_cleanup_callbacks) and you'd have to wrap PIDs in wrapper classes that make them behave like pointers, which would be weird. instead, we use a borrow checker on the global program at compile time to insert drops. yes, this means you have to annotate lifetimes. don't worry, it's not as bad as rust: they're [place-annotated](https://smallcultfollowing.com/babysteps/blog/2024/03/04/borrow-checking-without-lifetimes/), not region-annotated

## type system

[to be explored]

it will feature a mixed ownership/aliasable type system with the `owned` keyword. there is support for unresumable effects through `ctx` and `throws`

## examples

```ts
actor struct Counter {
  read i: number;  // outsiders can read but not write
}

// queries are request-response
query Counter.increment(): number {
  this.i += 1;
  return this.i;
}

const owned counterHandle = await Counter { i: 0 }.start();
const nextNumber = await counterHandle.increment();
```

```ts
actor struct DataProcessor {
  #results: handle ResultsActor; // private (only accessible inside the actor)
}

// commands are fire-and-forget
command DataProcessor.process(data: number[]) {
  const sum = data.reduce((a, b) => a + b, 0);
  this.results.store(sum);
}

actor struct ResultsActor {
  totals: number[] = []; // public and writable from outside the actor
}

command ResultsActor.store(value: number): void {
  this.totals.push(value);
}

// spawn them
const owned results = await ResultsActor { }.start();
const owned processor = await DataProcessor { results }.start();

// send work
processor.process([1, 2, 3, 4, 5]);
```

```ts
actor struct Supervisor {
  worker: handle RiskyWorker;
}

command Supervisor.monitor(): void {
  try {
    await this.worker.doRiskyThing();
  } catch (e: unknown) {
    this.worker = this.worker.reset { /* constructor fields */ }; // state is reset
  }
}

// note, commands can't accept handle borrows since they would have to be awaited, and commands can't be awaited
```

come to the dark side we have UFCS

```ts
function square(x: number) {
  return x * x;
}

console.log(2.square().square().square().square().square());
```

function type shorthand (usually `(T, U) -> V`)

```ts
// -> is shorthand for () -> ()
const callback: -> = () => { console.log("done"); };

// -> T is shorthand for () -> T
const getUser: -> User = () => currentUser;

function lazy<T>(init: -> T): T {
  return init();
}
```

lifetime examples

```ts
function longest(cond: boolean, x: handle Actor, y: handle Actor): handle<x, y> Actor { // must live shorter than *the handles in* x and y
  if (cond) {
    return x;
  } else {
    return y;
  }
}

const owned a = await Actor {}.start();
const owned b = await Actor {}.start();

const z: handle<a, b> Actor = longest(true, a, b);

// a and b must outlive z

// for example, when a's liveness ends (and all dependents), compiler inserts
drop(a); // free the memory for a
```

```ts
function makeAndExtend(): handle Actor {
  const owned a = await Actor {}.start();

  const z: handle<a, b> Actor = longest(true, a, b);
  // *do something with z*

  // *z's liveness ends*

  return a;
  // *a's liveness ends, owned actor gets returned*
}
```

```ts
struct Return {
  a: handle Actor;
  b: handle Actor;
  z: handle<this.a, this.b> Actor;
}

function makeAndExtendDependent1(): Return {
  const owned a = await Actor {}.start();
  const owned b = await Actor {}.start();
  const z: handle<a, b> Actor = longest(true, a, b);

  return Return { a, b, z };
}

struct LongestWrapper {
  z: handle Actor; // owned or referenced is fine here, if ref it caps the place lifetime
}

function makeAndExtendDependent2(): LongestWrapper</* uh oh, this function is impossible */> {
  const owned a = await Actor {}.start();
  const owned b = await Actor {}.start();

  // in means "dropped before all of these"
  const z: in<a, b> LongestWrapper = LongestWrapper { z: longest(true, a, b) };

  return z;
  // either a or b would get leaked here if allowed
}

function makeAndExtendDependent3(): Array<handle Actor> { // has its own lifetime
  return Promise.all(Array(20, () => Actor {}.start()));
}
```

```ts
function first(this: Array<handle Actor>): handle<this> Actor { // borrowed by default
  return this[0]; // borrowed
}

function pop(this: Array<handle Actor>): handle Actor {
  /* ... moved out ... */
}

function splice(this: Array<handle Actor>, start: number, deleteCount: number): Array<handle Actor> {
  /* ... moved out ... */
}

function drop(owned actor: handle Actor) { // actor is moved into this function, cannot be used at caller anymore
  /* .. moved in actor ... */
}
```

borrow checked cycles

```ts
let marker arena;
const owned parent = Parent (child: is<arena> undefined);
const owned child = Child (parent: is<arena> parent);
parent.child = child;

// drop order unspecified, parent or child may be dropped first
// arena is dropped
```

closure captures

closures borrow from enclosing scope by default. use `move` to take ownership

```ts
const owned x = Actor {}.start();
const owned y = Actor {}.start();

// borrows x and y, closure can't outlive them
const borrowing: in<x, y> -> = () => {
  use(x, y);
};

// moves x and y, closure owns them, can live independently
const owning = () => {
  move x, y;
  use(x, y);
};

// moves x, borrows y
const mixed: in<y> -> = () => {
  move x;
  use(x, y);
};
```

the `in<...>` annotation on closure type specifies which lifetimes it borrows from. a closure with no `in<>` and all captures moved has no lifetime constraints but it becomes an owned variable.

if a closure consumes a moved value, it becomes `once` — can only be called once:

```ts
// only reads moved value
const owned reusable = () => {
  move handle;
  console.log(handle.id);
};
reusable();  // ok, closure borrows its own data to run
reusable();  // ok

// `once` consumes moved value
const owned sendAway: once -> = () => {
  move handle;
  otherActor.give(handle);  // handle consumed
};
sendAway();  // ok
sendAway();  // error: closure already consumed itself
```

`once` is inferred from whether the body contains any consuming operations on moved values.

### `now` closures

closures marked `now` cannot escape the callee's body. the callee may invoke it zero, one, or many times, but cannot store, return, or pass it to async operations. this is a _lifetime_ constraint, not a guarantee that it will be evaluated.

```ts
function doThing(f: now ->) {
  f();  // ok: called synchronously
}

function filter<T>(arr: T[], f: now (T) -> bool): T[] {
  return arr.filter(f);  // ok: called 0-n times, doesn't escape
}

// illegal: now closure escaping
function bad(f: now ->) {
  storedCallback = f;    // error: can't store
  setTimeout(f, 100);    // error: can't pass to async
  return f;              // error: can't return
}
```

because `now` closures are scoped to the callee's stack frame, the compiler can reason about them bidirectionally:

**caller knowledge flows in**, type narrowing and state propagate into the closure body

```ts
let mut y = 5;
if (x != null) {
  doThing(now () => {
    x.foo();   // x is narrowed to non-null
    y += 1;    // compiler knows y is 5 here
  });
}
```

**closure effects flow out**, but only when execution is guaranteed (see next section)

```ts
// with filter, the closure might not run at all
items.filter(now x => {
  if (foo == null) throw 'Hello;
  return x > 2;
});
// foo is NOT narrowed here since filter might have called it 0 times
```

without `now`, closures are opaque, i.e. the compiler can't assume when or if they run, so effects can't escape. with `now`, the compiler knows effects are _bounded_ to the call site, but not necessarily that they _occurred_.

#### `now once`

adding `once` guarantees exactly one invocation:

```ts
function withResource<T>(f: now once (Resource) -> T): T {
  const r = acquire();  // cannot have unhandled exceptions
  const result = f(r);  // called exactly once
  release(r);
  return result;
}
```

this enables full dataflow analysis as if the closure body was inlined — mutations happen exactly once, and the closure can consume owned captures

### ctx

implicit state passed through calls using `ctx`. mutations are visible to callers (pass by reference)

```ts
function increment() ctx { counter: number } {
  ctx.counter += 1;
}

function main() {
  ctx.counter = 0;
  increment();
  increment();
  console.log(ctx.counter);  // 2
}
```

use `in` to snapshot a field (pass by value, isolated from caller, very cheap):

```ts
function isolated() ctx { in counter: number } {
  ctx.counter += 1;  // local copy, doesn't affect caller
}

function main() {
  ctx.counter = 0;
  isolated();
  console.log(ctx.counter);  // still 0
}
```

ctx blocks for scoped overrides:

```ts
function main() {
  ctx.theme = "dark";

  ctx { theme = "light" } {
    render();  // sees theme = "light"
  }

  render();  // sees theme = "dark"
}
```

ctx defaults:

```ts
function fibMemo(n: number): number ctx { memo: Map<number, number> = new Map() } {
  if (n <= 1) return n;
  if (ctx.memo.has(n)) return ctx.memo.get(n);

  const result = fibMemo(n - 1) + fibMemo(n - 2);
  ctx.memo.set(n, result);

  return result;
}
```

`static` for persistent (global) state across calls:

```ts
function counter() {
  static count: number = 0;
  count += 1;
  return count;
}

counter();  // 1
counter();  // 2
counter();  // 3
```

NOTE: while the function is stored across workers, the state is not, so you may have unexpected behavior when you invoke this in worker-invariant code

in some cases you may prefer `ctx`

### throws

unresumable algebraic effects. functions declare what they can throw, and callers must handle or propagate.

```ts
function divide(a: number, b: number): number throws DivisionByZero { // annotation is optional
  if (b === 0) throw DivisionByZero {};
  return a / b;
}

function main() {
  // must handle or propagate
  try {
    const result = divide(10, 0);
  } catch (_: DivisionByZero) {
    console.log("can't divide by zero");
  }
}
```

throws multiple

```ts
struct DivisionByZero {}
struct Overflow {}

function riskyMath(a: number, b: number, c: number): number throws DivisionByZero | Overflow {
  if (b === 0) throw DivisionByZero {};
  const result = a / b * c;
  if (result > Number.MAX_SAFE_INTEGER) throw Overflow {};
  return result;
}

// partial handling, unhandled effects propagate
function halfHandled(a: number, b: number, c: number): number throws Overflow {
  try {
    return riskyMath(a, b, c);
  } catch (_: DivisionByZero) {
    return 0; // default value for division by zero
  }
  // Overflow propagates to caller
}
```

with actors

```ts
actor struct NetworkClient {
  #url: string;
}

struct NetworkError { message: string }
struct Timeout {}

query NetworkClient.fetch(path: string): string throws NetworkError, Timeout {
  // ...
}

// caller handles the effects
const owned client = await NetworkClient { url: "https://api.example.com" }.start();

try {
  const data = await client.fetch("/users");
} catch (e: NetworkError) {
  console.log("network failed:", e.message);
} catch (_: Timeout) {
  console.log("request timed out");
}
```

throws polymorphism, functions can be generic over effects

```ts
function map<T, U, E>(this: T[], f: (T) -> U throws E): U[] throws E { // can be inferred
  return this.map(f);
}

// the effect of map depends on the effect of the passed function
function main() throws DivisionByZero {
  const results = map([1, 2, 3], x => divide(10, x)); // throws DivisionByZero
}
```

### stack unwinding and drops

when a `throw` unwinds the stack, owned resources need to be dropped. caffeine uses `try { /* ... */ } finally { /* drops */ }` to ensure that drops aren't skipped on the way up.

**important: drops are unordered.** this is an async actor system. drops just send messages, they don't wait. if you send a message to a dead actor, that's your problem.

no destructor ordering, no waiting for cleanup. actors handle their own shutdown whenever they get the drop message. be very careful about what code you put in actor drops.

### struct constructor shorthand

visibility keywords in constructor params promote them to fields:

```ts
struct Point(read x: number, read y: number) {
  // x, y become read-only fields
}

struct Counter(write count: number) {
  // count becomes a read/write field
}

struct Internal(#secret: string) {
  // secret becomes a private field
}

struct Mixed(x: number, read y: number) {
  // x is just a param (not a field)
  // y becomes a read-only field
  read sum = x + y;  // computed field
}
```

- bare `x: number`: just a constructor parameter
- `read x: number`: becomes a read-only field
- `write x: number`: becomes a read/write field
- `#x: number`: becomes a private field

general function calling shorthand

```ts
Point(x: 2, y: 4); // named parameters
Point(2, y: 4); // mixed named parameters
```

### operator overloading

custom operators can be defined using decorators. any sequence of symbols from `! # $ % & * + - . / < = > ? @ \ ^ | ~` can be an operator, except reserved ones (`=`, `==`, `=>`, `->`, `:`, etc).

precedence is specified relative to an existing operator, with optional `+ 1` or `- 1` to go above or below.

```ts
@infixl(++, +)        // left-associative, same precedence as +
function concat(a: string, b: string): string {
  return a + b
}

"hello" ++ " world"   // "hello world"

@infixl(<>, + - 1)    // one precedence level below +
function append(a: List<T>, b: List<T>): List<T> { ... }

@infixr(**, * + 1)    // right-associative, one level above *
function pow(a: number, b: number): number {
  return Math.pow(a, b)
}

2 ** 3 ** 2           // 512 (right-assoc: 2 ** (3 ** 2))
```

conflicts are resolved using parens or `>` constraints

### actor runtime

actors compile to async message handlers running in a web worker pool. a single worker handles multiple actors:

```ts
// generated worker code (conceptual)
const actors = new Map<ActorId, ActorInstance>();

self.onmessage = async ({ data: { actorId, type, payload, replyTo } }) => {
  const actor = actors.get(actorId);

  switch (type) {
    case "Counter.increment":
      await actor.increment(payload);
      break;
    case "Counter.getCount":
      const result = await actor.getCount(payload);
      postMessage({ replyTo, result });
      break;
    case "spawn":
      actors.set(actorId, new Counter(payload));
      break;
    case "drop":
      actors.delete(actorId);
      break;
  }
};
```

TODO: interleaving using `await`

there's no automatic gas/reduction system like erlang. if you write a blocking loop, you block the worker. the same thing happens in ui code.

### lazy

`lazy` is a variable modifier (like `atom`) for pull-based reactive values. the expression is evaluated on first access and cached. if dependencies change, it recomputes on next access.

```ts
let atom count = 0;           // push-based, notifies subscribers
let lazy doubled = count * 2; // pull-based, computes when accessed

doubled      // pulls current value, computes if stale
doubled&     // the Lazy<number> wrapper itself
```

for one-shot initialization (compute once, cache forever), use a function with no reactive dependencies:

```ts
let lazy conn = new WebSocket(url);  // initialized on first access, never recomputes
```

`Lazy<T>` is the underlying type when you need it explicitly, e.g. in struct fields:

```ts
function connect(url: string): WebSocket {
  return new WebSocket(url);
}

actor struct WebSocketedActor { // not pinned
  channel: Lazy<WebSocket>  // stores init closure, computes on access
}

let actor = WebSocketedActor { channel: lazy connect(url) };
actor.channel.send(msg);  // first access calls connect(url), then .send()
```

for serialization, only the initializer params are sent. the receiving side recreates the lazy wrapper and calls the initializer on first access. this allows non-Send types like `WebSocket` to have Send handles.

### adding non-local workers over a channel (distributed processing)

TODO

### symbols

symbols are unique identifiers, like erlang atoms or lisp keywords:

```rs
type Status = 'ok | 'error | 'pending;

const s: Status = 'ok;

// used in effects
function divide(a: number, b: number): number throws 'DivisionByZero {
  if (b === 0) throw 'DivisionByZero;
  return a / b;
}
```

### channels

channels are the fundamental message-passing primitive. they abstract over transport (local, worker, network):

```ts
const myChannel = Channel<number>();

// send
myChannel.send(42);

// receive
myChannel.on((n) => console.log(n));
```

a variant of channels, remote channels, may only send and receive serializable data

### atoms

atoms are reactive state, channels with a cached current value:

```ts
let atom count = 0;

count; // peek; unreactive
count~; // reactive read; must be in an atom or jsx expression container {...}
count = 5;
count.on(n => ...);
```

derived values auto-recompute (the compiler tracks dependency graph, with opts):

```ts
let atom doubled = count~ * 2;  // re-evaluates when count changes
```

note about static dependency tracking: unlike runtime-tracked reactivity (solid.js, jotai, etc.), caffeine analyzes non-dyn dependencies at compile time. every atom referenced with postfix `~` in an expression is subscribed to, regardless of conditionals:

```ts
let atom x = cond~ ? a~ : b~;
// subscribes to cond, a, AND b
// recomputes whenever any of them change

let atom y = cond~ ? a : b;
// does NOT subscribe to a or b
// only recomputes when cond changes
```

the compiler sees all atoms in the expression and subscribes to all of them. if the result doesn't actually change, downstream atoms don't update anyway

`any[]` merges multiple event sources:

```ts
any[(buttonA.on("click"), buttonB.on("click"), atom.on)].on(() =>
  console.log("hello world"),
);

// desugars to:
let handler = () => console.log("hello world");
buttonA.on("click", handler);
buttonB.on("click", handler);
atom.on(handler);
```

note: the `.on` after `any[]` is syntactically required since `any[]` is sugar, not a value.

### js framework

simple counter:

```tsx
component Counter() {
  let atom count = 0;

  return (
    <div>
      <span>{count~}</span>
      <button on:click={() => count += 1}>+</button>
    </div>
  );
}
```

todo list with derived state:

```tsx
component TodoApp() {
  let atom todos: Todo[] = [];
  let atom filter: "all" | "active" | "completed" = "all";

  let atom filtered = todos~.filter(
    | t if (filter === "all") => true
    | t if (filter === "active") => !t.done
    | t => t.done
  );

  let atom remaining = todos~.filter(t => !t.done).length;

  return (
    <div>
      <input on:keydown={
        e if (e.key === "Enter") => {
          todos.push({ id: Date.now(), text: e.target.value, done: false });
          e.target.value = "";
        } | or<>
      } />

      <ul>
        {filtered~.map(todo => <TodoItem todo={todo} />)}
      </ul>

      <footer>
        <span>{remaining~} items left</span>
        <button on:click={() => filter = "all"}>All</button>
        <button on:click={() => filter = "active"}>Active</button>
        <button on:click={() => filter = "completed"}>Completed</button>
      </footer>
    </div>
  );
}
```

reactive fetch with streams:

```tsx
component UserProfile({ userId }: { userId: string }) {
  let atom user = undefined;
  let atom error = undefined;

  // refetch when userId changes
  userId.on(async (id) => {
    try {
      user = await fetch(`/api/users/${id}`).then(r => r.json());
      error = undefined;
    } catch (e) {
      error = e;
    }
  });

  return (
    <div>
      {error~ ? <div class="error">{error.message}</div> :
       user~ ? <div>{user.name}</div> :
       <div>Loading...</div>}
    </div>
  );
}
```

channel-based chat:

```tsx
component Chat({ channel }: { channel: Channel<Message> }) {
  let atom history: Message[] = [];

  // subscribe to incoming messages
  channel.on(msg => history.push(msg));

  return (
    <div>
      <ul>
        {history~.map(m => <li>{m.user}: {m.text}</li>)}
      </ul>
      <input on:keydown={
        e if (e.key === "Enter") => {
          channel.send({ text: e.target.value });
          e.target.value = "";
        } | or<>
      } />
    </div>
  );
}
```

### unwrap

`unwrap` blocks until a value arrives from a continuation:

```ts
const myChannel = Channel<number>();

myChannel.send(42);

const n = unwrap myChannel.on;
console.log(n);  // 42
```

example: `await` is similar to unwrapping a promise:

```ts
const data = await fetch(url);
// is equivalent to:
const data = unwrap fetch(url).then;
// however in general we keep `await` because JS has native support for it
```

`unwrap` is the general primitive for any continuation (`.on`, `.then`).

### function sum types

functions can be composed into sum types for pattern matching:

```ts
type Message = Ping | Pong | Shutdown;

const handler =
  | (p: Ping) => reply(Pong())
  | (p: Pong) => { }
  | (s: Shutdown) => stop();

channel.on(handler);  // exhaustive
```

partial handlers throw when no match:

```rs
const partialHandler =
  | (p: Ping) => reply(Pong())
  | (s: Shutdown) => stop()
  | or<throw 'UnhandledPong>;

// type is: (Ping | Shutdown) => void throws 'UnhandledPong
channel.on(partialHandler);  // throws 'UnhandledPong on Pong
```

### or

`or` can be used to write guards, however it has a very low precedence

```ts
function verifyFormInputs() {
  input.length > 5 || input.disabled or<throw 'InsufficientCharacters>;
  email.includes("@") or<throw 'InvalidEmail>;
  password === confirmPassword or<throw 'PasswordMismatch>;
  acceptedTerms or<return false>;

  return true;
}

```

### postfix & and smart refs

types can define a `@deref` method to make variable access transparent. when accessing a variable, `@deref` is called implicitly. postfix `&` gives you the underlying wrapper:

```ts
let lazy channel = connect("wss://example.com");

channel        // calls deref, triggers initialization, returns WebSocket
channel&       // the Lazy<WebSocket> wrapper itself
```

user-defined smart ref:

```ts
struct Slot<T> {
  #arr: T[]
  read idx: number
}

@deref
function something<T>(this: Slot<T>): T | undefined {
  return this.arr[this.idx];
}

let slot: Slot<Person> = people.slot(3)
slot.name       // calls deref(), accesses person at index 3
slot&.idx       // the Slot wrapper, get the index
```

this is useful when you want transparent access most of the time, but occasionally need the wrapper for serialization, passing to another function, or avoiding side effects.

### multiplexed channels

channels can be multiplexed over a single transport (websocket, worker postMessage, etc.). subchannels are created automatically when you send channel references:

```ts
const wire = Multiplexed(WebSocket("ws://..."));

const channel = Channel();
wire.send(channel);

// receiving
wire.on((channel: Channel<number>) => {
  channel.on((n) => {
    // subscribes to the subchannel id
    console.log(n);
  });
});
```

under the hood, each subchannel gets an id. messages are tagged and routed:

```ts
// conceptually:
wire.send({ subchannelId: 5, payload: ... });
// receiver demuxes to the right subchannel
```

#### dynamic atoms

by default, atoms are statically optimized, meaning subscriptions resolved at compile time. `dyn atom` opts into runtime representation, enabling:

```ts
let atom localOnly = 0;       // static, maximally optimized
let dyn atom shareable = 0;   // runtime, can be passed around

channel.send(shareable&);     // ok: send atom reference
channel.send(localOnly&);     // error: localOnly is not dyn

shareable&    // type: Atom<number> (the reference)
shareable     // type: number (peek current value)
shareable~    // type: number (subscribe)
```

atoms are push-based. this means there are no roundtrip "peek" mechanisms other than caching

```ts
let dyn atom x = 1;
let dyn atom y = 2;
let dyn atom z = x~ + y~;

channel.send(z&); // negotiates a subchannel so that this atom can be subscribed to remotely

// on the remote:

channel.on(z: Atom<number> => {
  let w = ~z + 3; // sends a subscription with an id, starts listening on the channel for the id
});
```

when `w` is created, `z` is subscribed to and cached for cheap lookup. the channel pushes updates to `z` and `w` updates accordingly.

### compiler plugins

metaprogramming is done via compiler plugins, not in-language syntax. plugins are imported and hook into the compiler before IR lowering.

```ts
import { derive } from "caffeine-derive";
import { sql } from "caffeine-sql";

@derive(Serialize, Debug)
struct User {
  name: string;
  age: number;
}

const query = sql`SELECT * FROM users WHERE id = ${userId}`;
```

plugins work with the high level IR (HIR) after type resolution and scope building, but before SSI lowering. this gives them access to resolved types, scope information, lifetime/borrow annotations, and other semantic data. plugins can, for example, add methods to structs/actors, generate code based on type information, validate custom invariants, etc.

```ts
// conceptual api
import { Plugin, HIR } from "caffeine/compiler";

export const derive: Plugin = {
  attribute: "derive",
  transform(ir: HIR, node: StructNode, args: string[]) {
    // args = ["Serialize", "Debug"]
    const fields = ir.fieldsOf(node);

    // generate serialization method
    if (args.includes("Serialize")) {
      ir.addMethod(node, generateSerializer(fields));
    }

    // generate debug method
    if (args.includes("Debug")) {
      ir.addMethod(node, generateDebug(fields));
    }
  },
};
```

## will this be faster than react

probably. not necessarily because it's multithreaded, but because the control flow will be very dataflow analysis friendly. [🙏 blockdom](https://github.com/ged-odoo/blockdom)
