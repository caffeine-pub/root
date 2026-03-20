import { css } from "solid-styled";

export type DotStatus = "solid" | "active" | "planned" | "exploring";

interface DotProps {
  status: DotStatus;
  size?: "sm" | "md";
}

export function Dot(props: DotProps) {
  const size = () => props.size ?? "md";

  css`
    span.dot {
      border-radius: 50%;
      flex-shrink: 0;
      display: inline-block;
    }

    span.md {
      width: 10px;
      height: 10px;
    }

    span.sm {
      width: 8px;
      height: 8px;
    }

    span.solid {
      background: var(--green-dim);
    }

    span.active {
      background: var(--yellow);
      box-shadow: 0 0 0 3px var(--yellow-light);
    }

    span.planned {
      background: none;
      border: 2px solid var(--fg-dim);
    }

    span.exploring {
      background: none;
      border: 2px dashed var(--fg-faint);
    }
  `;

  return <span class={`dot ${size()} ${props.status}`} />;
}
