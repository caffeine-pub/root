import { css } from "solid-styled";
import type { ParentProps } from "solid-js";

type TextVariant = "hero" | "heading" | "body" | "mono" | "label";

interface TextProps extends ParentProps {
  variant?: TextVariant;
  class?: string;
}

export function Text(props: TextProps) {
  const variant = () => props.variant ?? "body";

  css`
    .hero {
      font-family: var(--grotesk);
      font-size: clamp(2.8rem, 7vw, 4.5rem);
      font-weight: 800;
      line-height: 1.05;
      letter-spacing: -0.04em;
    }

    .heading {
      font-family: var(--grotesk);
      font-size: clamp(2.2rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1.1;
    }

    .body {
      font-size: 1.15rem;
      font-weight: 400;
      line-height: 1.65;
      color: var(--fg-mid);
    }

    .mono {
      font-family: var(--mono);
      font-size: 0.8rem;
      color: var(--fg-dim);
    }

    .label {
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--fg-dim);
    }
  `;

  return (
    <span class={`${variant()}${props.class ? ` ${props.class}` : ""}`}>
      {props.children}
    </span>
  );
}

export function Highlight(props: ParentProps) {
  css`
    span.highlight {
      background: linear-gradient(to top, var(--yellow) 35%, transparent 35%);
      padding: 0 0.05em;
    }
  `;

  return <span class="highlight">{props.children}</span>;
}

export function Code(props: ParentProps) {
  css`
    code {
      font-family: var(--mono);
      font-size: 0.8rem;
      background: #f0f0ed;
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
    }
  `;

  return <code>{props.children}</code>;
}
