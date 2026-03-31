import { Title } from "@solidjs/meta";
import { css } from "solid-styled";
import { For } from "solid-js";
import { Nav, Text, Tag, Dot, Card, Code, Link } from "~/ui";
import type { DotStatus, TagVariant } from "~/ui";

declare const __ROADMAP_LAST_MODIFIED__: string;

// --- Data types ---

interface ChangelogEntry {
  badge: "new" | "moved" | "closed";
  text: string;
}

interface NodeData {
  status: DotStatus;
  name: string;
  note: string;
  tags?: Array<{ variant: TagVariant; label: string; href?: string }>;
}

interface AreaData {
  name: string;
  status: DotStatus;
  statusLabel: string;
  desc: string;
  depends?: string[];
  nodes: NodeData[];
  questions?: string[];
  questionTags?: Array<{
    index: number;
    variant: TagVariant;
    label: string;
    href: string;
  }>;
}

// --- Data ---

const changelog: ChangelogEntry[] = [
  {
    badge: "new",
    text: "call instantiation: context-sensitive analysis with HM-style levels (69 tests)",
  },
  {
    badge: "closed",
    text: "field-sensitive SSA: extending Braun et al. to version places",
  },
  {
    badge: "closed",
    text: "ts-arena (typed object pools with nominal ids)",
  },
  {
    badge: "moved",
    text: "analysis prototype: arena-ified places, objects, and functions",
  },
  {
    badge: "closed",
    text: "ts-hash (type-directed hashing)",
  },
  { badge: "moved", text: "analysis prototype: planned -> in progress" },
  { badge: "closed", text: "the caffeine.pub website" },
  { badge: "closed", text: "re" },
];

const areas: AreaData[] = [
  {
    name: "re (monorepo config manager)",
    status: "solid",
    statusLabel: "complete",
    desc: "Declarative TOML-based monorepo configuration with bidirectional sync",
    nodes: [
      {
        status: "solid",
        name: "workspace.toml & project.toml parsing",
        note: "Config files for package.json, tsconfig, prettier, vscode settings, engines, scripts",
      },
      {
        status: "solid",
        name: "bidirectional lens system",
        note: "Edit generated JSON files and changes sync back to TOML via composable field lenses",
      },
      {
        status: "solid",
        name: "WASM TOML mutation",
        note: "Write mutate-toml for preserving comments and formatting in toml files when syncing changes back",
      },
      {
        status: "solid",
        name: "daemon mode",
        note: "Watches config files, regenerates on change",
      },
      {
        status: "active",
        name: "make it robust",
        note: "Not all fields are supported, not all fields are synced. Add support when needed",
      },
    ],
  },
  {
    name: "ts-hash (type-directed hashing)",
    status: "solid",
    statusLabel: "complete",
    desc: "A TypeScript static analysis for fast hashing of data structures",
    nodes: [
      {
        status: "solid",
        name: "type extraction",
        note: "Walk interfaces, aliases, unions, intersections, generics, and produce a normalized type graph",
      },
      {
        status: "solid",
        name: "hash function codegen",
        note: "Generate specialized hash functions per type. Primitives inline, structs hash fields in declaration order, arrays stream elements",
      },
      {
        status: "solid",
        name: "recursive and circular types",
        note: "Recursive types emit composable helpers with cycle-safe refs. Supports self-recursive and mutually recursive types",
      },
      {
        status: "solid",
        name: "generics strategy",
        note: "Generic types produce genericized hash functions with trait-style constraints. Instantiated refs resolve concrete type arguments",
      },
      {
        status: "solid",
        name: "CLI",
        note: "Reads tsconfig, scans @hash types, writes hash.gen.ts, auto-adds path alias. 147 tests",
      },
      {
        status: "exploring",
        name: "fuzz with random types",
        note: "It should not loop forever",
      },
    ],
  },
  {
    name: "ts-arena (typed object pools)",
    status: "solid",
    statusLabel: "complete",
    desc: "Typed object pools with nominal ids and bitset-tracked liveness for arena-style memory management",
    nodes: [
      {
        status: "solid",
        name: "Arena<I, T> with nominal Id<Brand>",
        note: "Compile-time branded ids over raw numbers. Zero runtime cost for type safety",
      },
      {
        status: "solid",
        name: "Poolable interface with create/blank lifecycle",
        note: "Objects provide blank() constructor and create(...args) initializer for pool reuse",
      },
      {
        status: "solid",
        name: "BitSet-tracked liveness",
        note: "Compact Uint32Array-backed bit array with auto-resize. Freelist for O(1) slot reuse",
      },
      {
        status: "solid",
        name: "full API & tests",
        note: "alloc, get, tryGet, isLive, free, clear, forEach, iterator. 15 passing tests",
      },
    ],
  },
  {
    name: "analysis prototype",
    status: "active",
    statusLabel: "in progress",
    desc: "Prototype an iterative analysis to analyze call graph and interprocedural, field-sensitive points-to analysis at the same time",
    depends: ["ts-hash", "ts-arena"],
    nodes: [
      {
        status: "solid",
        name: "determine prototype language requirements",
        note: "Closures (w/ forward decls), calls, objects, fields, ifs, loops, and breaks should suffice",
      },
      {
        status: "solid",
        name: "lexer & parser",
        note: "JS-like syntax for the above",
      },
      {
        status: "solid",
        name: "arena-ify analysis data structures",
        note: "Places, abstract objects, and functions managed by typed pools. 50/62 tests passing",
      },
      {
        status: "exploring",
        name: "iterative analysis with call instantiation",
        note: "Discover call graph, run points-to analysis, reanalyze call graph, run points-to, iterate until fixpoint. 12 call-graph tests blocked on instantiation",
      },
      {
        status: "exploring",
        name: "field-sensitive SSA",
        note: "Extend Braun et al. SSA to version places (abstractObject × field). Prototype at 26 tests, open questions on loop field-reads",
      },
      {
        status: "planned",
        name: "satisfy all test cases",
        note: "Mutual recursion, loops, tree recursion, higher-order functions, multi-step discovery",
      },
      {
        status: "planned",
        name: "fuzz end to end",
        note: "Discover examples of possible infinite loops in the implementation and address them in the analysis",
      },
    ],
    questions: [
      "What happens when a new function is added by the user? We don't want to recompute everything and end up slow like Crystal (relevant: https://arxiv.org/abs/2412.10632)",
      "What are the edge cases where we lose context or precision in the points-to analysis? Even flow-insensitive field-sensitive interprocedural points-to is undecidable",
    ],
  },
  {
    name: "documentation",
    status: "planned",
    statusLabel: "planned",
    desc: "We should document the internals of everything we're doing",
    nodes: [
      {
        status: "solid",
        name: "write the caffeine.pub website",
        note: "You're looking at it",
      },
      {
        status: "planned",
        name: "document the analysis prototype",
        note: "People should be able to understand how the analysis works and why it works",
      },
      {
        status: "exploring",
        name: "start a blog",
        note: "Publish accessible posts on data-flow analysis",
      },
    ],
  },
  {
    name: "other fun things",
    status: "exploring",
    statusLabel: "exploring",
    desc: "caffeine.pub rocks",
    nodes: [
      {
        status: "exploring",
        name: "a logo",
        note: "What's the vibe?",
      },
      {
        status: "exploring",
        name: "contributor pathways",
        note: "Document how a contributor can join the organization",
      },
    ],
  },
];

// --- Components ---

function ChangelogStrip() {
  const badgeClass = (badge: string) => {
    switch (badge) {
      case "new":
        return "cl-new";
      case "moved":
        return "cl-moved";
      case "closed":
        return "cl-closed";
      default:
        return "";
    }
  };

  css`
    div.changelog {
      margin-bottom: 1rem;
      padding: 1.2rem 1.5rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
    }

    div.cl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.7rem;
    }

    span.cl-title {
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg-faint);
    }

    span.cl-date {
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--fg-faint);
    }

    div.cl-items {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    div.cl-item {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      font-size: 0.88rem;
      color: var(--fg-mid);
      line-height: 1.45;
    }

    span.cl-badge {
      font-family: var(--mono);
      font-size: 0.6rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      flex-shrink: 0;
    }

    span.cl-new {
      background: var(--pink);
      color: #fff;
    }

    span.cl-moved {
      background: var(--yellow);
      color: var(--fg);
    }

    span.cl-closed {
      background: var(--green-dim);
      color: #fff;
    }
  `;

  return (
    <div class="changelog">
      <div class="cl-header">
        <span class="cl-title">latest</span>
        <span class="cl-date">
          {new Date(__ROADMAP_LAST_MODIFIED__)
            .toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
            .toLowerCase()}
        </span>
      </div>
      <div class="cl-items">
        <For each={changelog}>
          {(entry) => (
            <div class="cl-item">
              <span class={`cl-badge ${badgeClass(entry.badge)}`}>
                {entry.badge === "closed" ? "done" : entry.badge}
              </span>
              {entry.text}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function Legend() {
  css`
    div.legend {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-bottom: 3rem;
      padding: 1rem 1.2rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
    }

    div.legend-item {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--fg-dim);
    }
  `;

  const statuses: Array<{ status: DotStatus; label: string }> = [
    { status: "solid", label: "done" },
    { status: "active", label: "in progress" },
    { status: "planned", label: "planned" },
    { status: "exploring", label: "exploring" },
  ];

  return (
    <div class="legend">
      <For each={statuses}>
        {(s) => (
          <div class="legend-item">
            <Dot status={s.status} />
            {s.label}
          </div>
        )}
      </For>
    </div>
  );
}

function AreaSection(props: { area: AreaData; index: number }) {
  const statusClass = () => {
    switch (props.area.status) {
      case "solid":
        return "status-solid";
      case "active":
        return "status-active";
      case "planned":
        return "status-planned";
      case "exploring":
        return "status-exploring";
    }
  };

  css`
    div.area {
      margin-bottom: 3rem;
    }

    div.area-header {
      display: flex;
      align-items: baseline;
      gap: 0.8rem;
      margin-bottom: 0.3rem;
      flex-wrap: wrap;
    }

    span.area-name {
      font-family: var(--grotesk);
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    span.area-status {
      font-family: var(--mono);
      font-size: 0.7rem;
      font-weight: 500;
      padding: 0.15rem 0.5rem;
      border-radius: 3px;
    }

    span.status-solid {
      background: var(--green-light);
      color: var(--green-dim);
    }

    span.status-active {
      background: var(--yellow-light);
      color: var(--orange);
    }

    span.status-planned {
      background: #f5f5f3;
      color: var(--fg-dim);
    }

    span.status-exploring {
      background: #f5f5f3;
      color: var(--fg-faint);
    }

    p.area-desc {
      font-size: 0.95rem;
      line-height: 1.6;
      color: var(--fg-mid);
      margin-bottom: 1rem;
      max-width: 640px;
    }

    div.area-depends {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--fg-faint);
      margin-bottom: 1rem;
    }

    div.area-depends span {
      color: var(--fg-dim);
      background: #f0f0ed;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      margin-left: 0.2rem;
    }

    div.nodes {
      display: flex;
      flex-direction: column;
    }

    div.node {
      display: flex;
      align-items: flex-start;
      gap: 0.8rem;
      padding: 0.75rem 0;
      border-top: 1px solid var(--line);
    }

    div.node:last-child {
      border-bottom: 1px solid var(--line);
    }

    div.node-dot-wrap {
      margin-top: 5px;
    }

    div.node-content {
      flex: 1;
    }

    div.node-top {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.15rem;
    }

    span.node-name {
      font-family: var(--grotesk);
      font-size: 0.9rem;
      font-weight: 600;
    }

    div.node-note {
      font-size: 0.85rem;
      color: var(--fg-dim);
      line-height: 1.5;
    }

    div.questions {
      margin-top: 1rem;
      padding: 1rem 1.2rem;
      background: var(--yellow-light);
      border-radius: 8px;
      border-left: 3px solid var(--yellow);
    }

    div.q-label {
      font-family: var(--mono);
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--orange);
      margin-bottom: 0.5rem;
    }

    p.q-text {
      font-size: 0.88rem;
      color: var(--fg-mid);
      line-height: 1.55;
      margin-bottom: 0.4rem;
    }

    p.q-text:last-child {
      margin-bottom: 0;
    }
  `;

  return (
    <div class="area" style={{}}>
      <div class="area-header">
        <span class="area-name">{props.area.name}</span>
        <span class={`area-status ${statusClass()}`}>
          {props.area.statusLabel}
        </span>
      </div>
      <p class="area-desc">{props.area.desc}</p>
      {props.area.depends && (
        <div class="area-depends">
          depends on -&gt;{" "}
          <For each={props.area.depends}>{(dep) => <span>{dep}</span>}</For>
        </div>
      )}
      <div class="nodes">
        <For each={props.area.nodes}>
          {(node) => (
            <div class="node">
              <div class="node-dot-wrap">
                <Dot status={node.status} />
              </div>
              <div class="node-content">
                <div class="node-top">
                  <span class="node-name">{node.name}</span>
                  {node.tags && (
                    <For each={node.tags}>
                      {(tag) => (
                        <Tag variant={tag.variant} href={tag.href}>
                          {tag.label}
                        </Tag>
                      )}
                    </For>
                  )}
                </div>
                <div class="node-note">{node.note}</div>
              </div>
            </div>
          )}
        </For>
      </div>
      {props.area.questions && (
        <div class="questions">
          <div class="q-label">open questions</div>
          <For each={props.area.questions}>
            {(q, i) => (
              <p class="q-text">
                {q}
                {props.area.questionTags
                  ?.filter((qt) => qt.index === i())
                  .map((qt) => (
                    <>
                      {" "}
                      <Tag variant={qt.variant} href={qt.href}>
                        {qt.label}
                      </Tag>
                    </>
                  ))}
              </p>
            )}
          </For>
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  css`
    div.page {
      max-width: 860px;
      margin: 0 auto;
      padding: 2.5rem 2rem 6rem;
    }

    div.header {
      margin-bottom: 2rem;
    }

    div.header h1 {
      margin-bottom: 1rem;
    }

    div.header p {
      font-size: 1.05rem;
      line-height: 1.65;
      color: var(--fg-mid);
      max-width: 600px;
    }

    @media (max-width: 600px) {
      div.page {
        padding: 2rem 1.5rem 4rem;
      }
    }
  `;

  return (
    <div class="page">
      <Title>roadmap / caffeine.pub</Title>
      <Nav />
      <div class="header">
        <h1>
          <Text variant="heading">roadmap</Text>
        </h1>
        <p>
          So this is awkward, but we don't actually have docs for Caffeine yet.
          That's what I'm working on right now. In the meantime, you can read{" "}
          <Link
            href="https://github.com/caffeine-pub/root/blob/main/README.md"
            external
          >
            my brain dump document!
          </Link>
        </p>
      </div>
      <ChangelogStrip />
      <Legend />
      <For each={areas}>
        {(area, i) => <AreaSection area={area} index={i()} />}
      </For>
    </div>
  );
}
