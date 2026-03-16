import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["cli.mts"],
    bundle: true,
    outfile: "dist/cli.mjs",
    format: "esm",
    platform: "node",
    target: "node22",
  }).then(async () => {
    let src = await readFile("dist/cli.mjs", "utf8");
    // replace tsx shebang with node
    src = src.replace("#!/usr/bin/env tsx", "#!/usr/bin/env node");
    // fix wasm path for published package
    src = src.replace(
      `"../mutate-toml/pkg/mutate_toml_bg.wasm"`,
      `"./mutate_toml_bg.wasm"`
    );
    await writeFile("dist/cli.mjs", src);
  }),
  copyFile("mutate-toml/pkg/mutate_toml_bg.wasm", "dist/mutate_toml_bg.wasm"),
]);
