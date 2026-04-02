import { Title } from "@solidjs/meta";
import { css } from "solid-styled";
import { Show, For, createResource, createSignal, onMount, onCleanup } from "solid-js";
import { useParams } from "@solidjs/router";
import { Nav } from "~/ui";
import { renderMarkdown, getAllPosts, getPostBySlug, type Post, type PostMeta } from "~/lib/markdown";
import { tagColors } from "~/lib/tags";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

function extractToc(html: string): TocItem[] {
  const re = /<h([23])\s+id="([^"]+)"[^>]*>(.*?)<\/h[23]>/gi;
  const items: TocItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    items.push({ level: parseInt(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, "") });
  }
  return items;
}


function getAdjacentPosts(slug: string): { prev: PostMeta | null; next: PostMeta | null } {
  const all = getAllPosts();
  const idx = all.findIndex((p) => p.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx < all.length - 1 ? all[idx + 1] : null,
    next: idx > 0 ? all[idx - 1] : null,
  };
}

export default function LogPost() {
  const params = useParams<{ slug: string }>();

  const [post] = createResource(
    () => params.slug,
    async (slug): Promise<Post | null> => {
      const raw = getPostBySlug(slug);
      if (!raw) return null;
      const result = await renderMarkdown(raw);
      result.slug = slug;
      return result;
    }
  );

  const adjacent = () => getAdjacentPosts(params.slug);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toLowerCase();
  };

  const readingTime = (html: string) => {
    const text = html.replace(/<[^>]*>/g, "");
    const words = text.split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 250));
  };

  css`
    /* --- TABLE OF CONTENTS --- */
    nav.toc {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      left: max(1rem, calc((100vw - 760px) / 2 - 300px));
      width: 260px;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    a.toc-item {
      font-family: var(--grotesk);
      font-size: 0.85rem;
      font-weight: 450;
      line-height: 1.5;
      color: var(--fg-faint);
      text-decoration: none;
      display: block;
      letter-spacing: 0.003em;
      position: relative;
      padding-left: 0.75rem;
      border-left: 2px solid transparent;
      transition: color 0.2s ease, border-color 0.2s ease;
    }
    a.toc-item:hover {
      color: var(--fg-mid);
    }
    a.toc-item.active {
      color: var(--fg);
      font-weight: 600;
      border-left-color: var(--fg);
    }
    a.toc-item.toc-h1 {
      font-weight: 600;
    }
    a.toc-item.toc-h3 {
      padding-left: 1.5rem;
    }
    @media (max-width: 1200px) {
      nav.toc {
        display: none;
      }
    }

    div.page {
      max-width: 760px;
      margin: 0 auto;
      padding: 2.5rem 2rem 6rem;
    }

    /* --- POST HEADER --- */
    div.post-header {
      margin-bottom: 3rem;
    }
    div.post-meta {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    span.post-date {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--fg-dim);
    }
    span.post-tag {
      font-family: var(--mono);
      font-size: 0.6rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.12rem 0.4rem;
      border-radius: 3px;
    }
    span.post-author {
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--fg-dim);
    }
    span.post-reading {
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--fg-faint);
    }
    h1.post-title {
      font-family: var(--grotesk);
      font-size: clamp(2rem, 5vw, 2.8rem);
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1.1;
      margin-bottom: 1rem;
    }
    p.lead {
      font-size: 1.15rem;
      font-weight: 500;
      line-height: 1.75;
      color: #2d2d2d;
      letter-spacing: 0.003em;
      max-width: 600px;
    }

    /* --- ARTICLE BODY --- */
    div.article {
      line-height: 1.75;
      font-size: 1.12rem;
      font-weight: 500;
      color: #000;
      text-rendering: optimizeLegibility;
      letter-spacing: 0.003em;
    }

    /* Headings */
    div.article :global(h2) {
      font-family: var(--grotesk);
      font-size: 1.55rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.2;
      margin-top: 3rem;
      margin-bottom: 0.8rem;
      color: var(--fg);
    }
    div.article :global(h3) {
      font-family: var(--grotesk);
      font-size: 1.2rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.3;
      margin-top: 2.2rem;
      margin-bottom: 0.6rem;
      color: var(--fg);
    }
    div.article :global(h4) {
      font-family: var(--mono);
      font-size: 0.85rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-top: 2rem;
      margin-bottom: 0.5rem;
      color: var(--fg-mid);
    }

    /* Paragraphs */
    div.article :global(p) {
      margin-bottom: 1.25rem;
      color: #2d2d2d;
    }

    /* Links */
    div.article :global(a) {
      color: var(--fg);
      text-decoration: none;
      border-bottom: 1.5px solid var(--yellow);
      transition: border-color 0.12s ease;
    }
    div.article :global(a:hover) {
      border-color: var(--fg);
    }

    /* Bold & Italic */
    div.article :global(strong) {
      font-weight: 600;
      color: var(--fg);
    }
    div.article :global(em) {
      font-style: italic;
    }

    /* Inline code */
    div.article :global(code) {
      font-family: var(--mono);
      font-size: 0.88em;
      background: #f0f0ed;
      padding: 0.12rem 0.4rem;
      border-radius: 3px;
      word-break: break-word;
    }

    /* Code blocks (shiki) */
    div.article :global(pre) {
      background: #1a1a1a;
      border-radius: 10px;
      padding: 1.4rem 1.6rem;
      margin: 1.5rem 0;
      overflow-x: auto;
      position: relative;
    }
    div.article :global(pre code) {
      font-family: var(--mono);
      font-size: 0.85rem;
      line-height: 1.6;
      background: none;
      padding: 0;
      border-radius: 0;
      color: inherit;
    }
    div.article :global(pre[data-lang]::after) {
      content: attr(data-lang);
      position: absolute;
      top: 0.7rem;
      right: 0.9rem;
      font-family: var(--mono);
      font-size: 0.6rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #555;
    }
    /* Override shiki's own pre bg */
    div.article :global(.shiki) {
      background-color: #1a1a1a !important;
      border-radius: 10px;
      padding: 1.4rem 1.6rem;
      margin: 1.5rem 0;
      overflow-x: auto;
      position: relative;
    }
    div.article :global(.shiki code) {
      font-family: var(--mono);
      font-size: 0.85rem;
      line-height: 1.6;
      background: none;
      padding: 0;
    }

    /* Blockquotes */
    div.article :global(blockquote) {
      border-left: 3px solid var(--yellow);
      padding: 0.8rem 1.2rem;
      margin: 1.5rem 0;
      background: var(--yellow-light);
      border-radius: 0 8px 8px 0;
    }
    div.article :global(blockquote p) {
      color: var(--fg-mid);
      margin-bottom: 0.5rem;
    }
    div.article :global(blockquote p:last-child) {
      margin-bottom: 0;
    }

    /* Lists */
    div.article :global(ul),
    div.article :global(ol) {
      margin: 1rem 0 1.25rem 1.4rem;
      color: var(--fg-mid);
    }
    div.article :global(li) {
      margin-bottom: 0.85rem;
      line-height: 1.75;
      padding-left: 0.3rem;
    }
    div.article :global(li::marker) {
      color: var(--fg-faint);
    }
    div.article :global(ul li::marker) {
      content: "— ";
      color: var(--yellow);
      font-weight: 700;
    }

    /* HR */
    div.article :global(hr) {
      border: none;
      height: 1px;
      background: var(--line);
      margin: 2.5rem 0;
    }

    /* Tables */
    div.article :global(table) {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5rem 0;
      font-size: 0.9rem;
    }
    div.article :global(thead) {
      border-bottom: 2px solid var(--line);
    }
    div.article :global(th) {
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--fg-dim);
      padding: 0.6rem 0.8rem;
      text-align: left;
    }
    div.article :global(td) {
      padding: 0.6rem 0.8rem;
      border-bottom: 1px solid var(--line);
      color: var(--fg-mid);
    }
    div.article :global(tbody tr:hover) {
      background: var(--yellow-light);
    }
    div.article :global(td code) {
      font-size: 0.82rem;
    }

    /* Footnotes */
    div.article :global(.footnote-ref) {
      font-family: var(--mono);
      font-size: 0.72em;
      color: var(--yellow);
      text-decoration: none;
      border-bottom: none;
      vertical-align: super;
      line-height: 0;
      padding: 0 0.1rem;
    }
    div.article :global(.footnote-backref) {
      font-family: var(--mono);
      font-size: 0.85em;
      color: var(--fg-dim);
      text-decoration: none;
      border-bottom: none;
      margin-left: 0.3rem;
    }
    div.article :global(.footnotes) {
      margin-top: 3rem;
      padding-top: 1.5rem;
      font-size: 0.88rem;
    }
    div.article :global(.footnotes hr) {
      margin-bottom: 1.5rem;
    }
    div.article :global(.footnotes li) {
      color: var(--fg-dim);
      margin-bottom: 0.6rem;
    }

    /* Callout/Aside */
    div.article :global(.callout) {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 1.1rem 1.3rem;
      margin: 1.5rem 0;
    }
    div.article :global(.callout-label) {
      font-family: var(--mono);
      font-size: 0.68rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--fg-dim);
      margin-bottom: 0.4rem;
    }
    div.article :global(.callout p) {
      font-size: 0.9rem;
      margin-bottom: 0.5rem;
      color: var(--fg-mid);
    }
    div.article :global(.callout p:last-child) {
      margin-bottom: 0;
    }

    /* --- POST NAV --- */
    div.post-nav {
      margin-top: 4rem;
      padding-top: 2rem;
      border-top: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      gap: 1.5rem;
    }
    a.nav-link {
      text-decoration: none;
      border-bottom: none;
      max-width: 48%;
    }
    a.nav-link:hover div.nav-title {
      color: var(--fg);
    }
    div.nav-label {
      font-family: var(--mono);
      font-size: 0.7rem;
      color: var(--fg-faint);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.2rem;
    }
    div.nav-title {
      font-family: var(--grotesk);
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--fg-mid);
      transition: color 0.12s ease;
    }
    a.nav-next {
      text-align: right;
      margin-left: auto;
    }

    @media (max-width: 600px) {
      div.page {
        padding: 2rem 1.5rem 4rem;
      }
      div.article :global(pre),
      div.article :global(.shiki) {
        border-radius: 0;
        margin-left: -1.5rem;
        margin-right: -1.5rem;
        padding: 1.2rem 1.5rem;
      }
      div.post-nav {
        flex-direction: column;
      }
      a.nav-link {
        max-width: 100%;
      }
      a.nav-next {
        text-align: left;
      }
    }
  `;

  return (
    <div class="page">
      <Show when={post()}>
        {(p) => (
            <>
              <Title>{p().title} / caffeine.pub</Title>
              <Nav
                links={[
                  { href: "/blog", label: "blog" },
                  { href: "/roadmap", label: "roadmap" },
                  { href: "https://github.com/caffeine-pub", label: "github", external: true },
                ]}
              />

              <div class="post-header">
                <div class="post-meta">
                  <span class="post-date">{formatDate(p().date)}</span>
                  {p().tags.map((tag) => {
                    const colors = tagColors[tag] ?? tagColors.tooling;
                    return (
                      <span
                        class="post-tag"
                        style={{ background: colors.bg, color: colors.color }}
                      >
                        {tag}
                      </span>
                    );
                  })}
                  <span class="post-author">by {p().author}</span>
                  <span class="post-reading">{readingTime(p().html)} min read</span>
                </div>
                <h1 class="post-title" id="title">{p().title}</h1>
                <p class="lead">{p().excerpt}</p>
              </div>

              {(() => {
                const items: TocItem[] = [
                  { id: "title", text: p().title, level: 1 },
                  ...extractToc(p().html),
                ];
                const [activeId, setActiveId] = createSignal("");
                onMount(() => {
                  const headings = items
                    .map((item) => ({ id: item.id, el: document.getElementById(item.id) }))
                    .filter((h) => h.el != null) as { id: string; el: HTMLElement }[];
                  const findActive = () => {
                    const scrollY = window.scrollY + 120;
                    let active = headings[0]?.id ?? "";
                    for (const h of headings) {
                      if (h.el.offsetTop <= scrollY) active = h.id;
                    }
                    setActiveId(active);
                  };
                  findActive();
                  window.addEventListener("scroll", findActive, { passive: true });
                  onCleanup(() => window.removeEventListener("scroll", findActive));
                });
                return (
                  <nav class="toc">
                    <For each={items}>
                      {(item) => (
                        <a
                          class={`toc-item toc-h${item.level}`}
                          classList={{ active: activeId() === item.id }}
                          href={`#${item.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" });
                          }}
                        >
                          {item.text}
                        </a>
                      )}
                    </For>
                  </nav>
                );
              })()}
              <div class="article" innerHTML={p().html} />

              <div class="post-nav">
                <Show when={adjacent().prev}>
                  {(prev) => (
                    <a class="nav-link" href={`/blog/${prev().slug}`}>
                      <div class="nav-label">← previous</div>
                      <div class="nav-title">{prev().title}</div>
                    </a>
                  )}
                </Show>
                <Show when={adjacent().next}>
                  {(next) => (
                    <a class="nav-link nav-next" href={`/blog/${next().slug}`}>
                      <div class="nav-label">next →</div>
                      <div class="nav-title">{next().title}</div>
                    </a>
                  )}
                </Show>
              </div>
            </>
        )}
      </Show>

      <Show when={post.loading}>
        <Nav
          links={[
            { href: "/blog", label: "blog" },
            { href: "/roadmap", label: "roadmap" },
            { href: "https://github.com/caffeine-pub", label: "github", external: true },
          ]}
        />
        <p style={{ color: "var(--fg-dim)", "font-family": "var(--mono)", "font-size": "0.85rem" }}>
          loading...
        </p>
      </Show>

      <Show when={!post.loading && !post()}>
        <Nav
          links={[
            { href: "/blog", label: "blog" },
            { href: "/roadmap", label: "roadmap" },
            { href: "https://github.com/caffeine-pub", label: "github", external: true },
          ]}
        />
        <h1 style={{ "font-family": "var(--grotesk)", "font-weight": "800", "font-size": "2rem" }}>
          not found
        </h1>
      </Show>
    </div>
  );
}
