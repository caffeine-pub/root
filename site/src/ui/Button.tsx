import { css } from "solid-styled";
import type { JSX, ParentProps } from "solid-js";

export type ButtonVariant = "primary" | "ghost" | "tier";

interface ButtonProps extends ParentProps {
  variant?: ButtonVariant;
  active?: boolean;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}

export function Button(props: ButtonProps) {
  const variant = () => props.variant ?? "primary";
  const active = () => props.active ?? false;

  css`
    button {
      font-family: var(--grotesk);
      cursor: pointer;
      border: none;
      transition: all 0.12s ease;
    }

    button:active {
      transform: scale(0.99);
    }

    button.primary {
      display: block;
      width: 100%;
      padding: 0.9rem;
      font-size: 0.95rem;
      font-weight: 700;
      text-align: center;
      color: var(--fg);
      background: var(--yellow);
      border: 2px solid var(--yellow);
      border-radius: 10px;
    }

    button.primary:hover {
      background: var(--yellow-hover);
      border-color: var(--yellow-hover);
    }

    button.primary:focus-visible {
      outline: none;
      border-color: var(--fg);
    }

    button.ghost {
      font-family: var(--mono);
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--fg);
      background: var(--yellow);
      padding: 0.65rem 1.3rem;
      border-radius: 8px;
      white-space: nowrap;
    }

    button.ghost:hover {
      background: var(--yellow-hover);
      transform: translateY(-1px);
    }

    button.tier {
      padding: 0.7rem 0.25rem;
      font-size: 1.05rem;
      font-weight: 700;
      text-align: center;
      color: var(--fg);
      background: #fff;
      border: 2px solid var(--line);
      border-radius: 8px;
      line-height: 1;
    }

    button.tier:hover {
      border-color: var(--yellow);
    }

    button.tier.active {
      border-color: var(--yellow);
      background: var(--yellow);
    }
  `;

  return (
    <button
      class={`${variant()}${active() ? " active" : ""}`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
