import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { JSDOM as JSDOMType } from "jsdom";

import {
  bootstrapSettingsPage,
  isPreviewData,
  isRequestId,
  isRuntimeResponse,
  isSettingsMessage,
  parseRequestId,
  SETTINGS_MESSAGE_TYPES,
} from "../src/settings/settings.js";
import { CONSENT_VERSION } from "../src/state/types.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const settingsDir = resolve(projectRoot, "src", "settings");
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as typeof import("jsdom");

type RuntimeMessageCall = {
  readonly type: string;
  readonly requestId?: string;
};

type InstalledSettingsPage = {
  readonly dom: JSDOMType;
  readonly cleanup: () => void;
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function installSettingsPage(
  html: string,
  requestId: string | null,
  chromeStub: unknown,
): InstalledSettingsPage {
  const query = requestId === null ? "" : `?requestId=${requestId}`;
  const dom = new JSDOM(html, {
    url: `chrome-extension://test-extension/settings/settings.html${query}`,
  });
  const globalObject = globalThis as unknown as Record<string, unknown>;
  const values: Record<string, unknown> = {
    chrome: chromeStub,
    document: dom.window.document,
    window: dom.window,
  };
  const previous = new Map<
    string,
    { readonly exists: boolean; readonly value: unknown }
  >();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, {
      exists: Object.hasOwn(globalObject, key),
      value: globalObject[key],
    });
    Object.defineProperty(globalObject, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  return {
    dom,
    cleanup: () => {
      for (const [key, state] of previous) {
        if (state.exists) {
          Object.defineProperty(globalObject, key, {
            configurable: true,
            value: state.value,
            writable: true,
          });
        } else {
          delete globalObject[key];
        }
      }
      dom.window.close();
    },
  };
}

async function flushAsyncWork(rounds = 3): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function previewResponse() {
  return {
    ok: true,
    preview: {
      destination: "https://chatgpt.com/" as const,
      prompt: "この文章を解説してください。\n\n非機密 fixture",
      selectionText: "非機密 fixture",
      sourceUrl: "https://x.com/example/status/123",
    },
  };
}

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

test("approve click は request の settle 前に approve message を送らず、拒否結果でも settle 後に一度だけ送る", async () => {
  const html = await readFile(resolve(settingsDir, "settings.html"), "utf8");
  const permissionRequest = createDeferred<boolean>();
  const calls: RuntimeMessageCall[] = [];
  let requestedPermissions: unknown;
  const chromeStub = {
    permissions: {
      request: (permissions: unknown) => {
        requestedPermissions = permissions;
        calls.push({ type: "permissions.request" });
        return permissionRequest.promise;
      },
    },
    runtime: {
      sendMessage: (message: RuntimeMessageCall) => {
        calls.push(message);
        if (message.type === SETTINGS_MESSAGE_TYPES.getPreview) {
          return Promise.resolve(previewResponse());
        }
        if (message.type === SETTINGS_MESSAGE_TYPES.approvePreview) {
          return Promise.resolve({ ok: false, message: "permission denied" });
        }
        throw new Error(`unexpected message: ${message.type}`);
      },
    },
  };
  const installed = installSettingsPage(
    html,
    "request-approve-denied",
    chromeStub,
  );

  try {
    bootstrapSettingsPage();
    await flushAsyncWork();

    const approveButton = installed.dom.window.document.getElementById(
      "approve-preview",
    ) as HTMLButtonElement;
    assert.equal(approveButton.disabled, false);

    approveButton.click();
    assert.deepEqual(
      calls.map(({ type }) => type),
      [SETTINGS_MESSAGE_TYPES.getPreview, "permissions.request"],
    );
    assert.deepEqual(requestedPermissions, {
      origins: ["https://chatgpt.com/*"],
      permissions: ["offscreen", "clipboardWrite"],
    });

    permissionRequest.resolve(false);
    await flushAsyncWork();

    assert.deepEqual(
      calls.map(({ type }) => type),
      [
        SETTINGS_MESSAGE_TYPES.getPreview,
        "permissions.request",
        SETTINGS_MESSAGE_TYPES.approvePreview,
      ],
    );
    assert.equal(
      calls.filter(({ type }) => type === SETTINGS_MESSAGE_TYPES.approvePreview)
        .length,
      1,
    );
  } finally {
    installed.cleanup();
  }
});

test("permission request が reject しても approve message は promise settle 後だけ送る", async () => {
  const html = await readFile(resolve(settingsDir, "settings.html"), "utf8");
  const permissionRequest = createDeferred<boolean>();
  const calls: RuntimeMessageCall[] = [];
  const chromeStub = {
    permissions: {
      request: () => {
        calls.push({ type: "permissions.request" });
        return permissionRequest.promise;
      },
    },
    runtime: {
      sendMessage: (message: RuntimeMessageCall) => {
        calls.push(message);
        return message.type === SETTINGS_MESSAGE_TYPES.getPreview
          ? Promise.resolve(previewResponse())
          : Promise.resolve({ ok: false, message: "permission denied" });
      },
    },
  };
  const installed = installSettingsPage(
    html,
    "request-approve-rejected",
    chromeStub,
  );

  try {
    bootstrapSettingsPage();
    await flushAsyncWork();
    const approveButton = installed.dom.window.document.getElementById(
      "approve-preview",
    ) as HTMLButtonElement;
    approveButton.click();
    assert.equal(
      calls.some(({ type }) => type === SETTINGS_MESSAGE_TYPES.approvePreview),
      false,
    );

    permissionRequest.reject(new Error("request failed"));
    await flushAsyncWork();
    assert.equal(
      calls.filter(({ type }) => type === SETTINGS_MESSAGE_TYPES.approvePreview)
        .length,
      1,
    );
  } finally {
    installed.cleanup();
  }
});

test("explicit reject は permission request を行わず reject message を一度だけ送る", async () => {
  const html = await readFile(resolve(settingsDir, "settings.html"), "utf8");
  const calls: RuntimeMessageCall[] = [];
  const chromeStub = {
    permissions: {
      request: () => {
        calls.push({ type: "permissions.request" });
        return Promise.resolve(true);
      },
    },
    runtime: {
      sendMessage: (message: RuntimeMessageCall) => {
        calls.push(message);
        return message.type === SETTINGS_MESSAGE_TYPES.getPreview
          ? Promise.resolve(previewResponse())
          : Promise.resolve({ ok: true, message: "送信せずに破棄しました。" });
      },
    },
  };
  const installed = installSettingsPage(
    html,
    "request-explicit-reject",
    chromeStub,
  );

  try {
    bootstrapSettingsPage();
    await flushAsyncWork();
    const rejectButton = installed.dom.window.document.getElementById(
      "reject-preview",
    ) as HTMLButtonElement;
    assert.equal(rejectButton.disabled, false);

    rejectButton.click();
    await flushAsyncWork();

    assert.deepEqual(
      calls.map(({ type }) => type),
      [SETTINGS_MESSAGE_TYPES.getPreview, SETTINGS_MESSAGE_TYPES.rejectPreview],
    );
    assert.equal(
      calls.some(({ type }) => type === "permissions.request"),
      false,
    );
  } finally {
    installed.cleanup();
  }
});

test("settings mode の revoke は consent 状態を消し、次回確認が必要な表示へ戻す", async () => {
  const html = await readFile(resolve(settingsDir, "settings.html"), "utf8");
  const calls: RuntimeMessageCall[] = [];
  const chromeStub = {
    runtime: {
      sendMessage: (message: RuntimeMessageCall) => {
        calls.push(message);
        if (message.type === SETTINGS_MESSAGE_TYPES.getSettings) {
          return Promise.resolve({
            ok: true,
            settings: { consentVersion: CONSENT_VERSION },
          });
        }
        return Promise.resolve({ ok: true, consentGranted: false });
      },
    },
  };
  const installed = installSettingsPage(html, null, chromeStub);

  try {
    bootstrapSettingsPage();
    await flushAsyncWork();
    const revokeButton = installed.dom.window.document.getElementById(
      "revoke-consent",
    ) as HTMLButtonElement;
    const consentStatus =
      installed.dom.window.document.getElementById("consent-status");
    assert.equal(revokeButton.disabled, false);
    assert.equal(consentStatus?.textContent, "同意済みです。");

    revokeButton.click();
    await flushAsyncWork();

    assert.deepEqual(
      calls.map(({ type }) => type),
      [
        SETTINGS_MESSAGE_TYPES.getSettings,
        SETTINGS_MESSAGE_TYPES.revokeConsent,
      ],
    );
    assert.equal(revokeButton.disabled, true);
    assert.equal(consentStatus?.textContent, "まだ同意していません。");
  } finally {
    installed.cleanup();
  }
});

test("revoke の確認失敗でも consentGranted=false なら UI は同意済み表示を残さない", async () => {
  const html = await readFile(resolve(settingsDir, "settings.html"), "utf8");
  const calls: RuntimeMessageCall[] = [];
  const chromeStub = {
    runtime: {
      sendMessage: (message: RuntimeMessageCall) => {
        calls.push(message);
        if (message.type === SETTINGS_MESSAGE_TYPES.getSettings) {
          return Promise.resolve({
            ok: true,
            settings: { consentVersion: CONSENT_VERSION },
          });
        }
        return Promise.resolve({
          ok: false,
          consentGranted: false,
          message: "権限の撤回を確認できませんでした。",
        });
      },
    },
  };
  const installed = installSettingsPage(html, null, chromeStub);

  try {
    bootstrapSettingsPage();
    await flushAsyncWork();
    const revokeButton = installed.dom.window.document.getElementById(
      "revoke-consent",
    ) as HTMLButtonElement;
    const consentStatus =
      installed.dom.window.document.getElementById("consent-status");
    assert.equal(revokeButton.disabled, false);

    revokeButton.click();
    await flushAsyncWork();

    assert.equal(revokeButton.disabled, true);
    assert.equal(consentStatus?.textContent, "まだ同意していません。");
    assert.match(
      installed.dom.window.document.getElementById("page-status")
        ?.textContent ?? "",
      /権限の撤回を確認できませんでした。/,
    );
    assert.deepEqual(
      calls.map(({ type }) => type),
      [
        SETTINGS_MESSAGE_TYPES.getSettings,
        SETTINGS_MESSAGE_TYPES.revokeConsent,
      ],
    );
  } finally {
    installed.cleanup();
  }
});
