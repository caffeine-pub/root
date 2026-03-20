import { Title } from "@solidjs/meta";
import { css } from "solid-styled";
import { Nav, Text, Highlight, Link, Card } from "~/ui";

function Hero() {
  css`
    div.hero {
      margin-bottom: 4.5rem;
    }

    h1 {
      font-family: var(--grotesk);
      font-size: clamp(2.8rem, 7vw, 4.5rem);
      font-weight: 800;
      line-height: 1.05;
      letter-spacing: -0.04em;
      margin-bottom: 1.5rem;
    }

    p {
      font-size: 1.15rem;
      font-weight: 400;
      line-height: 1.65;
      color: var(--fg-mid);
      max-width: 520px;
      margin-bottom: 1rem;
    }
  `;

  return (
    <div class="hero">
      <h1>
        an open developer
        <br />
        group for
        <br />
        building Caffeine ☕
      </h1>
      <p>
        Hi, it's just me right now, but I'm building Caffeine, a language and
        web framework that compiles to TypeScript.
      </p>
      <p>
        Check out the <Link href="/roadmap">roadmap</Link> or{" "}
        <Link href="https://discord.gg/QK9hvcnaQw" external>
          join the Discord
        </Link>
        .
      </p>
    </div>
  );
}

interface TimelineItem {
  date: string;
  content: string;
  bold?: string;
  project?: { label: string; href: string };
  now?: boolean;
}

const timelineData: TimelineItem[] = [
  {
    date: "Mar 20, 2026",
    bold: "caffeine.pub",
    content: " is up",
    now: true,
  },
  {
    date: "Mar 20, 2026",
    content: "wrote up the roadmap page",
  },
  {
    date: "Mar 17, 2026",
    content: "designed the website",
  },
  {
    date: "Mar 15, 2026",
    bold: "re v1.0.0",
    content: ", a JS monorepo manager that reduces configuration file clutter",
    // project: { label: "re", href: "/re" },
  },
  {
    date: "Mar 14, 2026",
    content: "the root repo is created",
  },
];

function Timeline() {
  css`
    div.timeline {
      position: relative;
      padding-left: 2.5rem;
      margin-bottom: 4rem;
    }

    div.timeline::before {
      content: "";
      position: absolute;
      left: 9px;
      top: 6px;
      bottom: 0;
      width: 2px;
      background: var(--line);
    }

    div.timeline::after {
      content: "";
      position: absolute;
      left: 0;
      bottom: 0;
      width: 20px;
      height: 3rem;
      background: linear-gradient(to bottom, transparent, var(--bg));
      z-index: 1;
    }

    div.tl-item {
      position: relative;
      margin-bottom: 2rem;
    }

    div.tl-item:last-child {
      margin-bottom: 0;
    }

    div.tl-item::before {
      content: "";
      position: absolute;
      left: -2.5rem;
      top: 6px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid var(--line);
      background: var(--bg);
      z-index: 2;
      transition: all 0.2s ease;
    }

    div.tl-item.now::before {
      border-color: var(--yellow);
      background: var(--yellow);
      box-shadow: 0 0 0 4px var(--yellow-light);
    }

    div.tl-date {
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg-dim);
      margin-bottom: 0.3rem;
    }

    div.tl-content {
      font-size: 0.95rem;
      font-weight: 400;
      line-height: 1.6;
      color: var(--fg-mid);
    }

    div.tl-content strong {
      font-weight: 600;
      color: var(--fg);
    }
  `;

  return (
    <div class="timeline">
      {timelineData.map((item, i) => (
        <div class={`tl-item${item.now ? " now" : ""}`}>
          <div class="tl-date">{item.date}</div>
          <div class="tl-content">
            {item.bold ? (
              <>
                <strong>{item.bold}</strong>
                {item.content}
              </>
            ) : (
              item.content
            )}
            {item.project && (
              <>
                <br />
                <Link href={item.project.href} variant="project">
                  {item.project.label} →
                </Link>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  css`
    div.page {
      max-width: 800px;
      margin: 0 auto;
      padding: 2.5rem 2rem 4rem;
    }

    @media (max-width: 600px) {
      div.page {
        padding: 2rem 1.5rem 3rem;
      }
    }
  `;

  return (
    <div class="page">
      <Title>caffeine.pub</Title>
      <Nav />
      <Hero />
      <Timeline />
    </div>
  );
}
