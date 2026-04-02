---
title: "why v3 starts with an interpreter"
date: 2026-03-14
tags: [compiler]
pinned: false
excerpt: "We've written two compilers now. Both got further than expected and failed where predicted. This time we're building the semantics first and the codegen last."
---

Here's the thing about writing a compiler for a language that doesn't exist yet: you're building the road while driving on it. Every design decision in the frontend constrains the backend, and every backend limitation feeds back into what the language *can even express*.

The first two versions of caffeine taught us this the hard way. v1 was a **proof of concept** — can we even parse this syntax? — and it answered that question in about three months. v2 was ambitious: a full pipeline from source to TypeScript, with name resolution, scoping, and a rudimentary type-checking pass. It *worked*. You could write caffeine programs and get runnable `.ts` files out the other end.

## what went wrong with v2

The problem wasn't the pipeline. The problem was that we kept discovering semantic questions — how does `owned` interact with closures? what happens when you `throw` inside a `command` handler? — and we had no fast way to answer them. Every experiment required threading changes through the entire compiler.

> The fastest way to learn what a language should do is to run programs in it. Not compile them — run them. See what happens. Change a rule. Run again.
>
> — internal notes, jan 2026

A compiler is the wrong tool for language exploration. It's a [batch process](https://en.wikipedia.org/wiki/Batch_processing) — you feed it source, it gives you output, and in between there's a pipeline of passes that all need to agree on what the language means. Changing one semantic rule can ripple through five stages.

## the interpreter-first approach

v3 inverts the process. We start with a tree-walking interpreter that takes the AST directly and evaluates it. No IR, no codegen, no optimization passes. Just: *what does this program do?*

```caffeine
actor struct Counter {
  count: owned Int = 0

  query get(): Int {
    return this.count
  }

  command increment() {
    this.count = this.count + 1
  }
}

let c = spawn Counter()
c.increment()
let val = unwrap c.get()
// val == 1
```

In the interpreter, `spawn` creates an object with an isolated message queue. `command` calls enqueue. `query` calls return continuations. It's not parallel — there are no web workers — but the *semantics* are identical to what the compiled version will do.

### what this buys us

The feedback loop collapses. Instead of "edit → compile → inspect TypeScript → run → debug", it's "edit → run". We can answer questions like:

- Does `unwrap` inside a `command` handler deadlock?
- If actor A owns actor B, and A throws, does B get dropped?
- Can a `now once` closure capture an `owned` value?
- What happens when two actors both hold `handle<x>` references to the same target and one drops?

These are questions we *had* during v2 and couldn't answer quickly. Each one required a multi-day spike through the compiler pipeline. With the interpreter, we can test a new semantic rule in an afternoon.

> [!aside]
> This is essentially what [Racket](https://racket-lang.org/) does with its `#lang` system — prototype a language semantics in an interpreter, then build the compiler when you know what you're compiling. We're not using Racket, but the philosophy is the same.

## the formal semantics angle

The other thing the interpreter gives us is a **reference implementation**. Not an informal spec, not prose descriptions of what things should do — actual executable semantics. If someone asks "what does caffeine do when X?", we can point to the interpreter and say "that."

We're writing the interpreter in TypeScript[^1], keeping it deliberately simple. The code is structured as a direct correspondence to the formal semantics we're writing alongside it:

| Formal rule | Interpreter function | Status |
| --- | --- | --- |
| `E-App` | `evalApplication()` | done |
| `E-Spawn` | `evalSpawn()` | done |
| `E-Query` | `evalQuery()` | in progress |
| `E-Command` | `evalCommand()` | in progress |
| `E-Drop` | `evalDrop()` | planned |
| `E-Throw` | `evalThrow()` | planned |

### the tradeoff

The obvious cost is time. We're adding a phase — build the interpreter, *then* build the compiler — which feels like it delays shipping. But the v2 postmortem was clear: we spent **more** time fighting semantic ambiguity inside the compiler than we would have spent building the interpreter upfront.

There's also a philosophical argument here. A language is defined by its semantics, not its implementation. If we can't express what caffeine *means* independently of how it compiles to TypeScript, then we don't actually have a language — we have a syntax skin over TypeScript. And that's not what we're building.

---

## what's next

The interpreter covers basic expressions, function calls, and actor spawning today. Over the next few weeks we're adding:

1. **Ownership tracking** — the interpreter will track which values are owned vs borrowed and reject invalid access at runtime.
2. **Message scheduling** — a deterministic single-threaded actor scheduler so we can write tests with predictable ordering.
3. **Effect handling** — `throw` and `handle` with stack unwinding and drop semantics.

If any of this is interesting, the interpreter lives at [`caffeine-pub/caffeine`](https://github.com/caffeine-pub/caffeine) and issue [#42](https://github.com/caffeine-pub/caffeine/issues/42) tracks the overall progress. Come break things.

[^1]: Yes, writing a TypeScript interpreter for a language that compiles to TypeScript. We're aware of the irony. The alternative was Rust, but we wanted contributors to be able to read and hack on the interpreter without a steep learning curve. The compiler itself might end up in Rust later — the interpreter won't.
