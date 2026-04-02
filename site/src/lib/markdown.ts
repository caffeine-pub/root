import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import rehypeSlug from "rehype-slug";
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["vitesse-dark"],
      langs: ["typescript", "javascript", "rust", "bash", "json", "html", "css"],
    });
  }
  return highlighterPromise;
}

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  author: string;
  tags: string[];
  pinned: boolean;
  excerpt: string;
}

export interface Post extends PostMeta {
  html: string;
}

function parseFrontmatter(raw: string): { meta: Record<string, any>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta: Record<string, any> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value: any = line.slice(idx + 1).trim();

    // parse arrays like [compiler, types]
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s: string) => s.trim());
    }
    // parse booleans
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    // strip quotes
    else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    meta[key] = value;
  }

  return { meta, content: match[2] };
}

// Handle callout blocks: > [!aside]\n> content → <div class="callout">
function transformCallouts(md: string): string {
  return md.replace(
    /> \[!(\w+)\]\n((?:> .*\n?)*)/g,
    (_match, label: string, body: string) => {
      const content = body.replace(/^> ?/gm, "").trim();
      return `<div class="callout"><div class="callout-label">${label}</div>\n\n${content}\n\n</div>\n`;
    }
  );
}

// Transform footnote definitions and references
function transformFootnotes(md: string): string {
  // Collect footnote definitions: [^N]: text
  const footnotes: Map<string, string> = new Map();
  let cleaned = md.replace(/^\[\^(\w+)\]: (.+)$/gm, (_match, id: string, text: string) => {
    footnotes.set(id, text);
    return "";
  });

  // Replace references: [^N] → superscript link
  cleaned = cleaned.replace(/\[\^(\w+)\]/g, (_match, id: string) => {
    return `<sup><a href="#fn-${id}" id="fnref-${id}" class="footnote-ref">${id}</a></sup>`;
  });

  // Append footnotes section if any
  if (footnotes.size > 0) {
    let section = `\n\n<div class="footnotes"><hr><ol>`;
    for (const [id, text] of footnotes) {
      section += `<li id="fn-${id}">${text} <a href="#fnref-${id}" class="footnote-backref">↩</a></li>`;
    }
    section += `</ol></div>`;
    cleaned += section;
  }

  return cleaned;
}

async function highlightCode(html: string): Promise<string> {
  const highlighter = await getHighlighter();

  // Match <pre><code class="language-xxx">...</code></pre> blocks
  return html.replace(
    /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang: string, code: string) => {
      // Decode HTML entities
      const decoded = code
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      try {
        // For unknown langs, fall back to plain
        const supported = highlighter.getLoadedLanguages();
        const effectiveLang = supported.includes(lang as any) ? lang : "text";

        const highlighted = highlighter.codeToHtml(decoded, {
          lang: effectiveLang,
          theme: "vitesse-dark",
        });

        // Add lang label
        return highlighted.replace(
          "<pre",
          `<pre data-lang="${lang}"`
        );
      } catch {
        return `<pre data-lang="${lang}"><code>${code}</code></pre>`;
      }
    }
  );
}

export async function renderMarkdown(raw: string): Promise<Post> {
  const { meta, content } = parseFrontmatter(raw);

  // Pre-process markdown
  let processed = transformCallouts(content);
  processed = transformFootnotes(processed);

  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(processed);

  let html = String(result);

  // Syntax highlighting
  html = await highlightCode(html);

  return {
    slug: "",
    title: meta.title ?? "Untitled",
    date: meta.date ?? "",
    author: meta.author ?? "ren",
    tags: meta.tags ?? [],
    pinned: meta.pinned ?? false,
    excerpt: meta.excerpt ?? "",
    html,
  };
}

// TODO: move glob-based post loading behind a server boundary when the archive grows.
// Currently all markdown is embedded in the client bundle via eager import.meta.glob.
// Fine for <20 posts; revisit with SolidStart's cache/createAsync pattern at scale.
export function getAllPosts(): PostMeta[] {
  // Import all markdown files at build time
  const modules = import.meta.glob("../content/blog/*.md", {
    query: "?raw",
    eager: true,
    import: "default",
  }) as Record<string, string>;

  const posts: PostMeta[] = [];

  for (const [path, raw] of Object.entries(modules)) {
    const slug = path.split("/").pop()!.replace(".md", "");
    const { meta } = parseFrontmatter(raw);

    posts.push({
      slug,
      title: meta.title ?? "Untitled",
      date: meta.date ?? "",
      author: meta.author ?? "ren",
      tags: meta.tags ?? [],
      pinned: meta.pinned ?? false,
      excerpt: meta.excerpt ?? "",
    });
  }

  // Sort by date, newest first
  posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return posts;
}

export function getPostBySlug(slug: string): string | null {
  const modules = import.meta.glob("../content/blog/*.md", {
    query: "?raw",
    eager: true,
    import: "default",
  }) as Record<string, string>;

  for (const [path, raw] of Object.entries(modules)) {
    const fileSlug = path.split("/").pop()!.replace(".md", "");
    if (fileSlug === slug) return raw;
  }

  return null;
}
