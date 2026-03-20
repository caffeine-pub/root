import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import type { PluginOption } from "vite";
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
  },
  define: {
    __ROADMAP_LAST_MODIFIED__: JSON.stringify(
      gitLastModified("src/routes/roadmap.tsx"),
    ),
  },
  plugins: [
    solidStart(),
    solidStyled.vite({
      filter: {
        include: "src/**/*.tsx",
        exclude: "node_modules/**/*.{ts,js}",
      },
    }) as PluginOption,
    nitro({
      preset: "cloudflare_module",
      cloudflare: {
        deployConfig: true,
      },
    }),
  ],
});
