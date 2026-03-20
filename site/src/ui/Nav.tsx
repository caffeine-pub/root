import { css } from "solid-styled";
import { Link } from "./Link";
import type { ParentProps } from "solid-js";

interface NavProps {
  noMargin?: boolean;
  links?: Array<{ href: string; label: string; external?: boolean }>;
}

const defaultLinks = [
  { href: "https://github.com/caffeine-pub", label: "github", external: true },
  { href: "/roadmap", label: "roadmap", external: false },
];

export function Nav(props: NavProps) {
  const links = () => props.links ?? defaultLinks;

  css`
    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    nav.margin {
      margin-bottom: 6rem;
    }

    a.wordmark {
      font-family: var(--grotesk);
      font-size: 1.3rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: var(--fg);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    div.nav-links {
      display: flex;
      gap: 0.6rem;
      align-items: center;
    }
  `;

  return (
    <nav class={props.noMargin ? "" : "margin"}>
      <a class="wordmark" href="/">
        caffeine.pub
      </a>
      <div class="nav-links">
        {links().map((link) => (
          <Link href={link.href} variant="nav" external={link.external}>
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
