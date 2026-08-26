import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isPreviewData,
  isRequestId,
  isRuntimeResponse,
  isSettingsMessage,
  parseRequestId,
  SETTINGS_MESSAGE_TYPES,
} from "../src/settings/settings.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const settingsDir = resolve(projectRoot, "src", "settings");

test("設定ページは外部資産とインライン実行を持たない", async () => {
  const [html, css, script] = await Promise.all([
    readFile(resolve(settingsDir, "settings.html"), "utf8"),
    readFile(resolve(settingsDir, "settings.css"), "utf8"),
    readFile(resolve(settingsDir, "settings.ts"), "utf8"),
  ]);
  const source = `${html}\n${css}\n${script}`;

  assert.match(html, /<script[^>]+src="settings\.js"[^>]+type="module"/);
  assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>/i);
  assert.doesNotMatch(
    source,
    /(?:innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(|new\s+Function)/i,
  );
  assert.doesNotMatch(source, /(?:src|href)\s*=\s*["']https?:\/\//i);
  assert.doesNotMatch(
    source,
    /https?:\/\/[^\s"']+\.(?:js|css|png|jpg|svg)(?:["'\s]|$)/i,
  );
});

test("設定ページは設定モードとプレビューモードの要素を持つ", async () => {
  const html = await readFile(resolve(settingsDir, "settings.html"), "utf8");

  for (const id of [
    "settings-view",
    "preview-view",
    "consent-status",
    "revoke-consent",
    "preview-destination",
    "preview-source-url",
    "preview-selection",
    "preview-prompt",
    "approve-preview",
    "reject-preview",
    "page-status",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(html, /https:\/\/chatgpt\.com\//);
  assert.match(html, /非公式な DOM 自動操作/);
  assert.match(html, /自動再送せず/);
  assert.match(html, /クリップボード/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /foreground-tab|openInBackground/);
});

test("requestId は query または fragment から読み取れるが、規定外文字列は受け付けない", () => {
  assert.equal(parseRequestId("?requestId=req-123", ""), "req-123");
  assert.equal(parseRequestId("", "#requestId=abc_456"), "abc_456");
  assert.equal(
    parseRequestId("?requestId=from-query", "#requestId=from-fragment"),
    "from-query",
  );
  assert.equal(parseRequestId("?requestId=bad%20value", ""), null);
  assert.equal(parseRequestId("", "#other=value"), null);
  assert.equal(isRequestId("request:1"), true);
  assert.equal(isRequestId("request/1"), false);
});

test("preview と settings の応答は宛先を固定し、動的文字列を検証する", () => {
  const preview = {
    destination: "https://chatgpt.com/",
    prompt: "この文章を解説してください。\n\n文章",
    selectionText: "選択された文章",
    sourceUrl: "https://x.com/example/status/123",
  };
  assert.equal(isPreviewData(preview), true);
  assert.equal(
    isPreviewData({ ...preview, destination: "https://evil.example/" }),
    false,
  );
  assert.equal(isPreviewData({ ...preview, prompt: "" }), false);

  assert.equal(
    isRuntimeResponse({
      ok: true,
      preview,
      settings: { consentVersion: null },
    }),
    true,
  );
  assert.equal(isRuntimeResponse({ ok: "yes" }), false);
  assert.equal(
    isRuntimeResponse({
      ok: true,
      preview: { ...preview, destination: "https://evil.example/" },
    }),
    false,
  );
});

test("runtime message contract は preview の approve/reject を requestId 付きに限定する", () => {
  assert.equal(
    isSettingsMessage({
      type: SETTINGS_MESSAGE_TYPES.approvePreview,
      requestId: "req-1",
    }),
    true,
  );
  assert.equal(
    isSettingsMessage({
      type: SETTINGS_MESSAGE_TYPES.rejectPreview,
      requestId: "req-1",
    }),
    true,
  );
  assert.equal(
    isSettingsMessage({
      type: SETTINGS_MESSAGE_TYPES.approvePreview,
      requestId: "req/1",
    }),
    false,
  );
  assert.equal(
    isSettingsMessage({
      type: "contextfling.settings.update",
      openInBackground: false,
    }),
    false,
  );
  assert.equal(
    isSettingsMessage({ type: "contextfling.settings.unknown" }),
    false,
  );
});

test("approve のクリックは設定ページから権限を直接要求してから approve message を送る", async () => {
  const [settingsSource, permissionSource] = await Promise.all([
    readFile(resolve(settingsDir, "settings.ts"), "utf8"),
    readFile(resolve(settingsDir, "permissions.ts"), "utf8"),
  ]);
  const handlerStart = settingsSource.indexOf(
    'elements.approveButton.addEventListener("click"',
  );
  const permissionRequest = settingsSource.indexOf(
    "chrome.permissions.request(",
    handlerStart,
  );
  const continuation = settingsSource.indexOf(".then(() =>", permissionRequest);
  const approveMessage = settingsSource.indexOf(
    "createApproveMessage(requestId)",
    continuation,
  );

  assert.ok(handlerStart >= 0);
  assert.ok(permissionRequest > handlerStart);
  assert.ok(continuation > permissionRequest);
  assert.ok(approveMessage > continuation);
  assert.doesNotMatch(
    settingsSource.slice(handlerStart, permissionRequest),
    /\bawait\b/,
  );
  assert.match(permissionSource, /offscreen/);
  assert.match(permissionSource, /clipboardWrite/);
  assert.match(permissionSource, /https:\/\/chatgpt\.com\/\*/);
});
