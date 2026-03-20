import { defineConfig } from "@solidjs/start/config";
import solidStyled from "unplugin-solid-styled";
import { execSync } from "child_process";

function gitLastModified(file: string): string {
  try {
    const ts = execSync(`git log -1 --format=%aI -- "${file}"`, {
      encoding: "utf-8",
    }).trim();
    return ts || new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export default defineConfig({
  server: {
    port: 3000,
    preset: "cloudflare_module",
    cloudflare: {
      deployConfig: true,
    },
  },
  vite: {
    define: {
      __ROADMAP_LAST_MODIFIED__: JSON.stringify(
        gitLastModified("src/routes/roadmap.tsx"),
      ),
    },
    plugins: [
      solidStyled.vite({
        filter: {
          include: "src/**/*.tsx",
          exclude: "node_modules/**/*.{ts,js}",
        },
      }),
    ],
  },
});
