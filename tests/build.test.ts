import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("build は MV3 の全エントリと静的ページを dist へ配置する", async () => {
  const source = await readFile(
    resolve(projectRoot, "scripts/build.mjs"),
    "utf8",
  );
  for (const entry of [
    "service-worker.ts",
    "settings/settings.ts",
    "offscreen/entry.ts",
  ]) {
    assert.match(source, new RegExp(entry.replaceAll("/", "\\/")));
  }
  for (const output of [
    "service-worker.js",
    "settings/settings.js",
    "offscreen.js",
    "settings/settings.html",
    "settings/settings.css",
    "offscreen.html",
  ]) {
    assert.match(source, new RegExp(output.replaceAll(".", "\\.")));
  }
  assert.match(source, /bundle:\s*true/);
  assert.doesNotMatch(source, /sourcemap\s*:/);
  assert.doesNotMatch(source, /https?:\/\//);
});
