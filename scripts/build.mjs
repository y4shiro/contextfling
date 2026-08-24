import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDir = resolve(projectRoot, "src");
const distDir = resolve(projectRoot, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(resolve(distDir, "settings"), { recursive: true });

await Promise.all([
  build({
    bundle: true,
    entryPoints: [resolve(sourceDir, "service-worker.ts")],
    format: "esm",
    outfile: resolve(distDir, "service-worker.js"),
    platform: "browser",
    target: "es2022",
  }),
  build({
    bundle: true,
    entryPoints: [resolve(sourceDir, "settings/settings.ts")],
    format: "esm",
    outfile: resolve(distDir, "settings/settings.js"),
    platform: "browser",
    target: "es2022",
  }),
  build({
    bundle: true,
    entryPoints: [resolve(sourceDir, "offscreen/entry.ts")],
    format: "esm",
    outfile: resolve(distDir, "offscreen.js"),
    platform: "browser",
    target: "es2022",
  }),
]);

await cp(
  resolve(sourceDir, "manifest.json"),
  resolve(distDir, "manifest.json"),
);
await Promise.all([
  cp(
    resolve(sourceDir, "settings/settings.html"),
    resolve(distDir, "settings/settings.html"),
  ),
  cp(
    resolve(sourceDir, "settings/settings.css"),
    resolve(distDir, "settings/settings.css"),
  ),
  cp(
    resolve(sourceDir, "offscreen/offscreen.html"),
    resolve(distDir, "offscreen.html"),
  ),
]);

console.log(`Built extension into ${distDir}`);
