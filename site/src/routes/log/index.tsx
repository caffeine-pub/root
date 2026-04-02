import { Title } from "@solidjs/meta";
import { css } from "solid-styled";
import { For, Show } from "solid-js";
import { Nav, Link } from "~/ui";
import { getAllPosts, type PostMeta } from "~/lib/markdown";

const tagColors: Record<string, { bg: string; color: string }> = {
  compiler: { bg: "var(--yellow-light)", color: "#b8860b" },
  design: { bg: "#f3e8ff", color: "#9333ea" },
  types: { bg: "#eff6ff", color: "#3b82f6" },
  runtime: { bg: "#ecfdf5", color: "#22c55e" },
  meta: { bg: "#fdf2f8", color: "#ec4899" },
  tooling: { bg: "#f0f0ed", color: "var(--fg-dim)" },
};

function PostTag(props: { tag: string }) {
  const style = () => tagColors[props.tag] ?? tagColors.tooling;

  css`
    span.post-tag {
      font-family: var(--mono);
      font-size: 0.6rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.12rem 0.4rem;
      border-radius: 3px;
    }
  `;

  return (
    <span
      class="post-tag"
      style={{ background: style().bg, color: style().color }}
    >
      {props.tag}
    </span>
  );
}

function PostItem(props: { post: PostMeta }) {
  css`
    a.post {
      display: flex;
      align-items: baseline;
      gap: 1.2rem;
      padding: 0.85rem 0;
      border-bottom: 1px solid var(--line);
      transition: all 0.12s ease;
      cursor: pointer;
      position: relative;
      text-decoration: none;
      color: inherit;
    }
    a.post:hover {
      padding-left: 0.6rem;
    }
    a.post:hover .post-title {
      color: var(--fg);
    }
    a.post:hover::before {
      content: "";
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 60%;
      background: var(--yellow);
      border-radius: 2px;
    }
    span.post-date {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--fg-faint);
      white-space: nowrap;
      flex-shrink: 0;
      min-width: 5.5rem;
    }
    div.post-body {
      flex: 1;
      min-width: 0;
    }
    div.post-title {
      font-family: var(--grotesk);
      font-size: 1rem;
      font-weight: 600;
      color: var(--fg-mid);
      line-height: 1.35;
      transition: color 0.12s ease;
      margin-bottom: 0.15rem;
    }
    div.post-excerpt {
      font-size: 0.85rem;
      color: var(--fg-dim);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    div.post-tags {
      display: flex;
      gap: 0.35rem;
      flex-shrink: 0;
      align-self: center;
    }

    @media (max-width: 600px) {
      a.post {
        flex-direction: column;
        gap: 0.2rem;
      }
      div.post-tags {
        align-self: flex-start;
        margin-top: 0.3rem;
      }
    }
  `;

  const date = () => {
    const d = new Date(props.post.date + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
  };

  return (
    <a class="post" href={`/log/${props.post.slug}`}>
      <span class="post-date">{date()}</span>
      <div class="post-body">
        <div class="post-title">{props.post.title}</div>
        <div class="post-excerpt">{props.post.excerpt}</div>
      </div>
      <div class="post-tags">
        <For each={props.post.tags}>{(tag) => <PostTag tag={tag} />}</For>
      </div>
    </a>
  );
}

function PinnedPost(props: { post: PostMeta }) {
  css`
    a.pinned-post {
      display: flex;
      align-items: baseline;
      gap: 1.2rem;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      border-radius: 8px;
      padding: 1.1rem 1.3rem;
      margin-bottom: 0.5rem;
      text-decoration: none;
      color: inherit;
      transition: all 0.12s ease;
      cursor: pointer;
    }
    a.pinned-post:hover {
      border-color: var(--yellow);
    }
    a.pinned-post:hover .pinned-title {
      color: var(--fg);
    }
    div.pinned-body {
      flex: 1;
      min-width: 0;
    }
    div.pinned-title {
      font-family: var(--grotesk);
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--fg);
      line-height: 1.35;
      transition: color 0.12s ease;
      margin-bottom: 0.15rem;
    }
    div.pinned-excerpt {
      font-size: 0.85rem;
      color: var(--fg-dim);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    div.pinned-tags {
      display: flex;
      gap: 0.35rem;
      flex-shrink: 0;
      align-self: center;
    }
  `;

  return (
    <a class="pinned-post" href={`/log/${props.post.slug}`}>
      <div class="pinned-body">
        <div class="pinned-title">{props.post.title}</div>
        <div class="pinned-excerpt">{props.post.excerpt}</div>
      </div>
      <div class="pinned-tags">
        <For each={props.post.tags}>{(tag) => <PostTag tag={tag} />}</For>
      </div>
    </a>
  );
}

function SubscribeMock() {
  css`
    div.subscribe {
      margin-top: 1rem;
      padding: 1.5rem 1.8rem;
      background: var(--fg);
      color: var(--bg);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      flex-wrap: wrap;
    }
    h3.sub-title {
      font-family: var(--grotesk);
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 0.2rem;
    }
    p.sub-desc {
      font-size: 0.85rem;
      color: #999;
      line-height: 1.4;
    }
    div.sub-form {
      display: flex;
      gap: 0.4rem;
      flex-shrink: 0;
    }
    input.sub-input {
      font-family: var(--mono);
      font-size: 0.8rem;
      padding: 0.55rem 0.8rem;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 6px;
      color: #fff;
      outline: none;
      width: 180px;
      transition: border-color 0.15s ease;
    }
    input.sub-input::placeholder {
      color: #666;
    }
    input.sub-input:focus {
      border-color: var(--yellow);
    }
    button.sub-btn {
      font-family: var(--mono);
      font-size: 0.8rem;
      font-weight: 500;
      padding: 0.55rem 1rem;
      background: var(--yellow);
      color: var(--fg);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.12s ease;
      white-space: nowrap;
    }
    button.sub-btn:hover {
      background: var(--yellow-hover);
    }

    @media (max-width: 600px) {
      div.subscribe {
        flex-direction: column;
        align-items: flex-start;
      }
      div.sub-form {
        width: 100%;
      }
      input.sub-input {
        flex: 1;
        width: auto;
      }
    }
  `;

  return (
    <div class="subscribe">
      <div>
        <h3 class="sub-title">get the log in your inbox</h3>
        <p class="sub-desc">New posts only. No spam. Unsubscribe whenever.</p>
      </div>
      <div class="sub-form">
        <input class="sub-input" type="email" placeholder="you@example.com" />
        <button class="sub-btn" type="button">subscribe</button>
      </div>
    </div>
  );
}

export default function LogIndex() {
  const allPosts = getAllPosts();
  const pinned = () => allPosts.filter((p) => p.pinned);
  const regular = () => allPosts.filter((p) => !p.pinned);

  // Group by year
  const byYear = () => {
    const groups: Map<number, PostMeta[]> = new Map();
    for (const post of regular()) {
      const year = new Date(post.date + "T00:00:00").getFullYear();
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year)!.push(post);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  };

  css`
    div.page {
      max-width: 800px;
      margin: 0 auto;
      padding: 2.5rem 2rem 6rem;
    }
    div.header {
      margin-bottom: 3rem;
    }
    h1.title {
      font-family: var(--grotesk);
      font-size: clamp(2.2rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1.1;
      margin-bottom: 0.8rem;
    }
    p.subtitle {
      font-size: 1.05rem;
      line-height: 1.65;
      color: var(--fg-mid);
      max-width: 540px;
    }
    div.pinned-section {
      margin-bottom: 2.5rem;
    }
    div.pinned-label {
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--yellow);
      margin-bottom: 0.8rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    div.pinned-label::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--line);
    }
    div.year-group {
      margin-bottom: 2.5rem;
    }
    div.year-marker {
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg-faint);
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--line);
    }

    @media (max-width: 600px) {
      div.page {
        padding: 2rem 1.5rem 4rem;
      }
    }
  `;

  return (
    <div class="page">
      <Title>log — caffeine.pub</Title>
      <Nav
        links={[
          { href: "/", label: "home" },
          { href: "/roadmap", label: "roadmap" },
          { href: "https://github.com/caffeine-pub", label: "github", external: true },
        ]}
      />

      <div class="header">
        <h1 class="title">the log</h1>
        <p class="subtitle">
          Design notes, compiler archaeology, and the occasional rant about
          why JavaScript doesn't have to be like this.
        </p>
      </div>

      <Show when={pinned().length > 0}>
        <div class="pinned-section">
          <div class="pinned-label">pinned</div>
          <For each={pinned()}>{(post) => <PinnedPost post={post} />}</For>
        </div>
      </Show>

      <For each={byYear()}>
        {([year, posts]) => (
          <div class="year-group">
            <div class="year-marker">{year}</div>
            <For each={posts}>{(post) => <PostItem post={post} />}</For>
          </div>
        )}
      </For>

      <SubscribeMock />
    </div>
  );
}
