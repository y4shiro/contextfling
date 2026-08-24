import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("ChatGPT adapter は executeScript の自己完結関数と serializable input を公開する", async () => {
  const [adapterSource, selectorSource] = await Promise.all([
    readFile(
      resolve(projectRoot, "src/destinations/chatgpt/adapter.ts"),
      "utf8",
    ),
    readFile(
      resolve(projectRoot, "src/destinations/chatgpt/selectors.ts"),
      "utf8",
    ),
  ]);

  assert.match(adapterSource, /export async function runChatGptAdapter/);
  assert.match(adapterSource, /createChatGptAdapterInput/);
  assert.match(adapterSource, /selectors:\s*ChatGptSelectorRegistry/);
  assert.match(selectorSource, /CHATGPT_SELECTOR_REGISTRY/);
  assert.match(adapterSource, /timeoutMs\?/);
  assert.match(adapterSource, /postSubmitTimeoutMs\?/);
});

test("ChatGPT selector registry は入力・送信・ログイン候補を専用境界に置く", async () => {
  const selectorSource = await readFile(
    resolve(projectRoot, "src/destinations/chatgpt/selectors.ts"),
    "utf8",
  );

  assert.ok(selectorSource.includes('textarea[data-testid="textbox"]'));
  assert.ok(selectorSource.includes('data-testid="send-button"'));
  assert.ok(selectorSource.includes("loginMarker"));
  assert.match(selectorSource, /Object\.freeze/);
});

test("DOM adapter と banner の実装は危険なページ境界を利用しない", async () => {
  const adapterSource = await readFile(
    resolve(projectRoot, "src/destinations/chatgpt/adapter.ts"),
    "utf8",
  );
  const bannerSource = await readFile(
    resolve(projectRoot, "src/destinations/chatgpt/banner.ts"),
    "utf8",
  );

  assert.match(adapterSource, /MutationObserver/);
  assert.match(adapterSource, /setTimeout/);
  assert.match(adapterSource, /\.click\(\)/);
  assert.doesNotMatch(adapterSource, /innerHTML/);
  assert.doesNotMatch(adapterSource, /document\.cookie/);
  assert.doesNotMatch(adapterSource, /(?:localStorage|sessionStorage)/);
  assert.doesNotMatch(adapterSource, /\bfetch\s*\(/);
  assert.match(
    adapterSource,
    /document\.contains\(composer\)[\s\S]*?finish\(false\)/,
  );
  assert.match(
    adapterSource,
    /composer\.closest\("form"\) \?\? composer\.parentElement/,
  );
  assert.match(adapterSource, /new Set<Element>\(\)/);
  assert.match(adapterSource, /waitForUniqueVisible\(/);
  assert.doesNotMatch(
    adapterSource,
    /const sendButton = await waitForElement\(/,
  );
  assert.doesNotMatch(bannerSource, /innerHTML/);
  assert.match(bannerSource, /attachShadow/);
  assert.doesNotMatch(bannerSource, /textContent\s*=\s*input/);
});

test("banner は selection 本文を含めず固定の失敗状態だけを表示する", async () => {
  const bannerSource = await readFile(
    resolve(projectRoot, "src/destinations/chatgpt/banner.ts"),
    "utf8",
  );
  assert.match(bannerSource, /clipboard-copied/);
  assert.match(bannerSource, /clipboard-failed/);
  assert.match(bannerSource, /dom-failure/);
  assert.match(bannerSource, /ChatGPT/);
  assert.doesNotMatch(bannerSource, /selectionText/);
  const bannerInput =
    bannerSource.match(/export interface ChatGptBannerInput[\s\S]*?\n}/)?.[0] ??
    "";
  assert.doesNotMatch(bannerInput, /prompt/);
});

test("ChatGPT fixture はログイン済み、未ログイン、DOM変更の3状態を分離する", async () => {
  const fixtureDir = resolve(projectRoot, "tests/fixtures/chatgpt");
  const [composer, login, changed] = await Promise.all([
    readFile(resolve(fixtureDir, "composer.html"), "utf8"),
    readFile(resolve(fixtureDir, "login.html"), "utf8"),
    readFile(resolve(fixtureDir, "dom-changed.html"), "utf8"),
  ]);

  assert.match(composer, /data-testid="textbox"/);
  assert.match(composer, /data-testid="send-button"/);
  assert.match(login, /auth\/login/);
  assert.doesNotMatch(login, /data-testid="textbox"/);
  assert.match(changed, /unsupported-composer/);
  assert.doesNotMatch(changed, /data-testid="textbox"/);
});
