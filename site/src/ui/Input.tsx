import { css } from "solid-styled";
import type { JSX } from "solid-js";

interface InputProps {
  type?: string;
  placeholder?: string;
  min?: string;
  step?: string;
  value?: string | number;
  onInput?: JSX.EventHandlerUnion<HTMLInputElement, InputEvent>;
  prefix?: string;
}

export function Input(props: InputProps) {
  css`
    div.input-wrap {
      display: flex;
      align-items: center;
      padding: 0.45rem 0;
    }

    span.prefix {
      font-family: var(--grotesk);
      font-size: 1rem;
      font-weight: 700;
      color: var(--fg-faint);
    }

    input {
      font-family: var(--grotesk);
      font-size: 1rem;
      font-weight: 600;
      color: var(--fg);
      border: none;
      outline: none;
      background: transparent;
      padding: 0.3rem 0.4rem;
      width: 100%;
    }

    input::placeholder {
      color: var(--fg-faint);
      font-weight: 400;
      font-size: 0.88rem;
    }
  `;

  return (
    <div class="input-wrap">
      {props.prefix && <span class="prefix">{props.prefix}</span>}
      <input
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        min={props.min}
        step={props.step}
        value={props.value ?? ""}
        onInput={props.onInput}
      />
    </div>
  );
}
