import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDir = resolve(projectRoot, "src");
const distDir = resolve(projectRoot, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  bundle: true,
  entryPoints: [resolve(sourceDir, "service-worker.ts")],
  format: "esm",
  outfile: resolve(distDir, "service-worker.js"),
  platform: "browser",
  target: "es2022",
});

await cp(
  resolve(sourceDir, "manifest.json"),
  resolve(distDir, "manifest.json"),
);

console.log(`Built extension into ${distDir}`);
