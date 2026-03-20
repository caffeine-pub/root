import { css } from "solid-styled";

export function GlobalStyles() {
  css`
    @global {
      :root {
        --bg: #fafaf8;
        --fg: #1a1a1a;
        --fg-mid: #555;
        --fg-dim: #999;
        --fg-faint: #bbb;
        --yellow: #f5c518;
        --yellow-light: #fef9e1;
        --yellow-hover: #ffe566;
        --green: #4ade80;
        --green-light: #ecfdf5;
        --green-dim: #22c55e;
        --orange: #f59e0b;
        --orange-light: #fffbeb;
        --blue: #3b82f6;
        --blue-light: #eff6ff;
        --pink: #ec4899;
        --pink-light: #fdf2f8;
        --line: #e8e8e5;
        --card-bg: #fff;
        --card-border: #eee;
        --grotesk: "Schibsted Grotesk", system-ui, sans-serif;
        --mono: "IBM Plex Mono", monospace;
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      ::selection {
        background: var(--yellow);
        color: var(--fg);
      }

      html {
        font-size: 16px;
        -webkit-font-smoothing: antialiased;
      }

      body {
        background: var(--bg);
        color: var(--fg);
        font-family: var(--grotesk);
        min-height: 100vh;
        overflow-x: hidden;
      }

      a {
        color: inherit;
        text-decoration: none;
      }
    }
  `;
  return null;
}
