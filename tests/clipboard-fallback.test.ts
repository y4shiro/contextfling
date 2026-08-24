import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("offscreen は static HTML と runtime messaging だけで clipboard を扱う", async () => {
  const [html, source] = await Promise.all([
    readFile(resolve(projectRoot, "src/offscreen/offscreen.html"), "utf8"),
    readFile(resolve(projectRoot, "src/offscreen/clipboard.ts"), "utf8"),
  ]);
  assert.match(html, /<script[^>]+src="offscreen\.js"/);
  assert.doesNotMatch(html, /<script[^>]*>\s*[^<\s]/i);
  assert.match(source, /CLIPBOARD_WRITE_MESSAGE/);
  assert.match(source, /ClipboardWriter/);
  assert.match(source, /runtime\.onMessage/);
  assert.match(source, /writeTextOnce/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /chrome\.tabs|chrome\.scripting/);
});

test("offscreen message handler は request ID の重複と失敗を型付きで返す", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/offscreen/clipboard.ts"),
    "utf8",
  );
  assert.match(source, /handledRequestIds/);
  assert.match(source, /duplicate-request/);
  assert.match(source, /write-failed/);
  assert.match(source, /sendResponse\(response\)/);
  assert.match(source, /return true/);
});

test("fallback coordinator は offscreen create/write/close の同時実行を直列化する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/handoff/fallback.ts"),
    "utf8",
  );
  assert.match(source, /hasDocument\(\)/);
  assert.match(source, /createDocument\(\)/);
  assert.match(source, /closeDocument\(\)/);
  assert.match(source, /let tail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(source, /tail\.then/);
  assert.match(source, /CLIPBOARD_WRITE_MESSAGE/);
  assert.doesNotMatch(source, /chrome\.storage/);
  assert.doesNotMatch(source, /globalThis\.[A-Za-z]+Lock/);
});

test("clipboard failure は prompt を保存せず banner へ明示的に渡す", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/handoff/fallback.ts"),
    "utf8",
  );
  assert.match(source, /clipboard-failed/);
  assert.match(source, /showBanner/);
  assert.match(source, /bannerShown/);
  assert.match(source, /writeText\(\{/);
  assert.doesNotMatch(source, /storage\.local|storage\.session/);
});
