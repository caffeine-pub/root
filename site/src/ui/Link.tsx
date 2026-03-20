import { css } from "solid-styled";
import type { ParentProps } from "solid-js";

export type LinkVariant = "nav" | "project" | "inline" | "subtle" | "button";

interface LinkProps extends ParentProps {
  href: string;
  variant?: LinkVariant;
  external?: boolean;
}

export function Link(props: LinkProps) {
  const variant = () => props.variant ?? "inline";

  css`
    a.nav {
      font-family: var(--mono);
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--fg-dim);
      padding: 0.55rem 1.1rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      transition: all 0.15s ease;
    }

    a.nav:hover {
      border-color: var(--yellow);
      background: var(--yellow-light);
      color: var(--fg);
    }

    a.project {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.5rem;
      font-family: var(--mono);
      font-size: 0.8rem;
      color: var(--fg-dim);
      padding: 0.25rem 0.6rem;
      background: #f0f0ed;
      border-radius: 4px;
      transition: all 0.15s ease;
    }

    a.project:hover {
      background: var(--yellow);
      color: var(--fg);
    }

    a.inline {
      color: var(--fg);
      border-bottom: 1px solid var(--yellow);
      transition: border-color 0.15s ease;
    }

    a.inline:hover {
      border-color: var(--fg);
    }

    a.subtle {
      font-family: var(--mono);
      font-size: 0.75rem;
      color: var(--fg-dim);
      transition: color 0.12s ease;
    }

    a.subtle:hover {
      color: var(--fg);
    }

    a.button {
      font-family: var(--mono);
      font-size: 0.82rem;
      font-weight: 500;
      padding: 0.55rem 1.1rem;
      border-radius: 8px;
      background: var(--yellow);
      color: var(--fg);
      transition: all 0.15s ease;
    }

    a.button:hover {
      background: var(--yellow-hover);
    }
  `;

  return (
    <a
      class={variant()}
      href={props.href}
      target={props.external ? "_blank" : undefined}
      rel={props.external ? "noopener noreferrer" : undefined}
    >
      {props.children}
    </a>
  );
}
