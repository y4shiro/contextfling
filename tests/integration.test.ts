import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  approvePending,
  attachConsentTab,
  attachTargetTab,
  claimPending,
  createPendingPayload,
  markAdapterAttempted,
} from "../src/state/machine.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("v0.1 handoff の pending は同意 tab、target tab、adapter attempt を一度だけ記録する", () => {
  const initial = createPendingPayload({
    id: "request-integration-1",
    sourceUrl: "https://x.com/alice/status/42",
    selectionText: "選択内容",
    prompt: "固定 prompt",
    createdAt: 1_000,
    expiresAt: 20_000,
  });
  const consent = attachConsentTab(initial, 10, 1_001);
  assert.ok(consent);
  const queued = approvePending(consent, 1_002);
  assert.ok(queued);
  const claimed = claimPending(queued, "claim-integration-1", undefined, 1_003);
  assert.ok(claimed);
  const target = attachTargetTab(claimed, 20, 1_004);
  assert.ok(target);
  const attempted = markAdapterAttempted(target, 1_005);
  assert.ok(attempted);
  assert.equal(attempted.adapterAttemptedAt, 1_005);
  assert.equal(markAdapterAttempted(attempted, 1_006), null);
});

test("service worker は v0.1 の権限境界と一回限り終端を実装する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );

  for (const listener of [
    "chrome.runtime.onInstalled.addListener",
    "chrome.runtime.onStartup.addListener",
    "chrome.contextMenus.onClicked.addListener",
    "chrome.tabs.onUpdated.addListener",
    "chrome.tabs.onRemoved.addListener",
    "chrome.runtime.onMessage.addListener",
  ]) {
    assert.match(source, new RegExp(listener.replaceAll(".", "\\.")));
  }
  assert.match(source, /title:\s*"ChatGPTで解説する"/);
  assert.match(source, /contexts:\s*\["selection"\]/);
  assert.match(source, /permissions\.contains\(OPTIONAL_PERMISSION_BUNDLE\)/);
  assert.match(source, /markAdapterAttempted\(/);
  assert.match(source, /adapterAttemptedAt !== undefined/);
  assert.match(source, /func: runChatGptAdapter/);
  assert.match(source, /func: showChatGptBanner/);
  assert.doesNotMatch(source, /chrome\.tabs\.query/);
  assert.doesNotMatch(
    source,
    /document\.cookie|\bfetch\s*\(|\beval\s*\(|new\s+Function/,
  );
  assert.match(source, /MENU_DOCUMENT_URL_PATTERNS/);
  assert.match(source, /https:\/\/x\.com\/\*"/);
  assert.match(source, /https:\/\/www\.x\.com\/\*"/);
  assert.match(source, /https:\/\/twitter\.com\/\*"/);
  assert.match(source, /https:\/\/www\.twitter\.com\/\*"/);
  assert.doesNotMatch(source, /https:\/\/\*\.(?:x|twitter)\.com/);
  assert.doesNotMatch(source, /chrome\.permissions\.request\(/);
});

test("settings message は拡張機能の settings ページだけから処理する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  assert.match(
    source,
    /if \(!isSettingsPageSender\(sender\) \|\| !isSettingsMessage\(message\)\)/,
  );
  assert.match(source, /parsed\.protocol === "chrome-extension:"/);
  assert.match(source, /parsed\.pathname === `\/\$\{SETTINGS_PATH\}`/);
});

test("service worker は permission request を行わず contains で最終確認する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  assert.match(source, /permissions\.contains\(OPTIONAL_PERMISSION_BUNDLE\)/);
  assert.doesNotMatch(source, /chrome\.permissions\.request\(/);
});

test("consent と target tab は state 保存後に目的 URL へ遷移する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  const consentStart = source.indexOf("async function openConsentPage");
  const queueStart = source.indexOf("async function queueExistingPayload");
  const consentFlow = source.slice(consentStart, queueStart);
  assert.match(consentFlow, /url: "about:blank"/);
  assert.ok(consentFlow.indexOf("await store.set(withConsentTab)") >= 0);
  assert.ok(
    consentFlow.indexOf("await store.set(withConsentTab)") <
      consentFlow.indexOf("await chrome.tabs.update"),
  );

  const launchStart = source.indexOf("async function launchQueuedOnce");
  const lookupStart = source.indexOf("async function findPendingForTargetTab");
  const targetFlow = source.slice(launchStart, lookupStart);
  assert.match(targetFlow, /url: "about:blank"/);
  assert.ok(targetFlow.indexOf("await store.set(withTarget)") >= 0);
  assert.ok(
    targetFlow.indexOf("await store.set(withTarget)") <
      targetFlow.indexOf("await chrome.tabs.update"),
  );
  assert.match(source, /async function launchQueued\(/);
  assert.match(
    source,
    /async function launchQueued\([\s\S]*?catch \{[\s\S]*?removePending\(requestIdValue\)/,
  );
});

test("adapter attempt marker と予期しない queue/target 例外は再送を防ぎ終端する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  assert.match(source, /payload\.adapterAttemptedAt !== undefined/);
  assert.match(
    source,
    /async function processTargetTabOnce\([\s\S]*?catch \{[\s\S]*?removePending\(requestIdValue\)/,
  );
});
