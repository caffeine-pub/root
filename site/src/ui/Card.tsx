import { css } from "solid-styled";
import type { ParentProps } from "solid-js";

export type CardVariant = "default" | "dark" | "dashed";

interface CardProps extends ParentProps {
  variant?: CardVariant;
}

export function Card(props: CardProps) {
  const variant = () => props.variant ?? "default";

  css`
    div.card {
      border-radius: 12px;
      transition: all 0.2s ease;
    }

    div.default {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      padding: 1rem 1.2rem;
    }

    div.dark {
      background: var(--fg);
      color: var(--bg);
      padding: 2.5rem;
    }

    div.dashed {
      background: #fff;
      border: 1px dashed #ddd;
      border-radius: 10px;
      padding: 1.3rem 1.8rem;
    }

    div.dashed:hover {
      border-color: var(--yellow);
      border-style: solid;
    }
  `;

  return <div class={`card ${variant()}`}>{props.children}</div>;
}
