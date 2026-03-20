import { css } from "solid-styled";
import type { ParentProps } from "solid-js";

export type TagVariant = "new" | "changed" | "issue" | "rfc" | "help";

interface TagProps extends ParentProps {
  variant: TagVariant;
  href?: string;
}

export function Tag(props: TagProps) {
  css`
    span.tag,
    a.tag {
      font-family: var(--mono);
      font-size: 0.62rem;
      font-weight: 500;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      vertical-align: 1px;
      text-decoration: none;
      transition: all 0.15s ease;
      display: inline-block;
    }

    .tag-new {
      background: var(--pink-light);
      color: var(--pink);
    }

    .tag-changed {
      background: var(--yellow-light);
      color: var(--orange);
    }

    .tag-issue {
      background: var(--blue-light);
      color: var(--blue);
      cursor: pointer;
    }

    .tag-issue:hover {
      background: var(--blue);
      color: #fff;
    }

    .tag-rfc {
      background: #f3e8ff;
      color: #9333ea;
      cursor: pointer;
    }

    .tag-rfc:hover {
      background: #9333ea;
      color: #fff;
    }

    .tag-help {
      background: var(--green-light);
      color: var(--green-dim);
      cursor: pointer;
    }

    .tag-help:hover {
      background: var(--green-dim);
      color: #fff;
    }
  `;

  if (props.href) {
    return (
      <a class={`tag tag-${props.variant}`} href={props.href}>
        {props.children}
      </a>
    );
  }

  return (
    <span class={`tag tag-${props.variant}`}>
      {props.children}
    </span>
  );
}
