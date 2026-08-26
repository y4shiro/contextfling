import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyAdapterAttemptDisposition,
  classifyTargetNavigationUrl,
} from "../src/service-worker.js";
import {
  hasOptionalPermissionBundle,
  OPTIONAL_PERMISSION_BUNDLE,
  type OptionalPermissionPort,
  revokeOptionalPermissionBundle,
} from "../src/settings/permissions.js";
import {
  approvePending,
  attachConsentTab,
  attachTargetTab,
  claimPending,
  createPendingPayload,
  markAdapterAttempted,
} from "../src/state/machine.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("target navigation は about:blank/未確定を保留し ChatGPT URL だけを ready にする", () => {
  assert.equal(classifyTargetNavigationUrl(undefined), "unknown");
  assert.equal(classifyTargetNavigationUrl(""), "unknown");
  assert.equal(classifyTargetNavigationUrl("about:blank"), "pending");
  assert.equal(classifyTargetNavigationUrl("https://chatgpt.com/"), "ready");
  assert.equal(
    classifyTargetNavigationUrl("https://chatgpt.com/c/new"),
    "ready",
  );
  assert.equal(
    classifyTargetNavigationUrl("https://example.com/"),
    "non-target",
  );
});

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
  assert.match(source, /hasOptionalPermissionBundle\(chrome\.permissions\)/);
  assert.match(
    source,
    /revokeOptionalPermissionBundle\(\s*chrome\.permissions,?\s*\)/,
  );
  assert.match(source, /markAdapterAttempted\(/);
  assert.match(source, /classifyAdapterAttemptDisposition\(payload\)/);
  assert.match(source, /func: runChatGptAdapter/);
  assert.match(source, /func: showChatGptBanner/);
  assert.doesNotMatch(source, /chrome\.tabs\.query/);
  assert.doesNotMatch(
    source,
    /document\.cookie|\bfetch\s*\(|\beval\s*\(|new\s+Function/,
  );
  assert.match(source, /MENU_DOCUMENT_URL_PATTERNS/);
  assert.doesNotMatch(source, /openInBackground/);
  assert.match(source, /changeInfo\.url \?\? tab\.url/);
  assert.match(source, /navigationState === "pending"/);
  assert.match(source, /navigationState === "ready"/);
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
  assert.match(source, /hasOptionalPermissionBundle\(chrome\.permissions\)/);
  assert.doesNotMatch(source, /chrome\.permissions\.request\(/);
});

test("optional permission bundle の contains は bundle 一式を検証し、API例外は不足扱いにする", async () => {
  const calls: chrome.permissions.Permissions[] = [];
  const port: OptionalPermissionPort = {
    contains: async (permissions) => {
      calls.push(permissions);
      return true;
    },
    remove: async () => true,
  };

  assert.equal(await hasOptionalPermissionBundle(port), true);
  assert.deepEqual(calls, [OPTIONAL_PERMISSION_BUNDLE]);

  const failedPort: OptionalPermissionPort = {
    contains: async () => {
      throw new Error("contains failed");
    },
    remove: async () => true,
  };
  assert.equal(await hasOptionalPermissionBundle(failedPort), false);
});

test("optional permission revoke は remove 後に全 component を確認し、部分撤回を成功扱いにしない", async () => {
  const removeCalls: chrome.permissions.Permissions[] = [];
  const containsCalls: chrome.permissions.Permissions[] = [];
  let resolveRemoval!: (value: boolean | PromiseLike<boolean>) => void;
  const removal = new Promise<boolean>((resolve) => {
    resolveRemoval = resolve;
  });
  const port: OptionalPermissionPort = {
    contains: async (permissions) => {
      containsCalls.push(permissions);
      return false;
    },
    remove: async (permissions) => {
      removeCalls.push(permissions);
      await removal;
      return true;
    },
  };

  const revocation = revokeOptionalPermissionBundle(port);
  await Promise.resolve();
  assert.deepEqual(containsCalls, []);
  resolveRemoval(true);
  assert.equal(await revocation, true);
  assert.deepEqual(removeCalls, [OPTIONAL_PERMISSION_BUNDLE]);
  assert.deepEqual(containsCalls, [
    { permissions: ["offscreen"] },
    { permissions: ["clipboardWrite"] },
    { origins: ["https://chatgpt.com/*"] },
  ]);

  const partialPort: OptionalPermissionPort = {
    contains: async (permissions) =>
      permissions.permissions?.includes("clipboardWrite") ?? false,
    remove: async () => true,
  };
  assert.equal(await revokeOptionalPermissionBundle(partialPort), false);

  const removeFailedButAbsentPort: OptionalPermissionPort = {
    contains: async () => false,
    remove: async () => {
      throw new Error("remove failed");
    },
  };
  assert.equal(
    await revokeOptionalPermissionBundle(removeFailedButAbsentPort),
    true,
  );

  const verificationFailedPort: OptionalPermissionPort = {
    contains: async () => {
      throw new Error("verification failed");
    },
    remove: async () => true,
  };
  assert.equal(
    await revokeOptionalPermissionBundle(verificationFailedPort),
    false,
  );
});

test("approve の permission 不足・拒否は consent 保存と handoff より先に pending cleanup で終端する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  const handlerStart = source.indexOf("async function handleSettingsMessage");
  const listenerStart = source.indexOf(
    "function registerListeners",
    handlerStart,
  );
  const handlerSource = source.slice(handlerStart, listenerStart);
  const gateStart = handlerSource.indexOf(
    "const permissionGranted = await hasOptionalPermissions();",
  );
  const denyStart = handlerSource.indexOf(
    "if (!permissionGranted) {",
    gateStart,
  );
  const denyEnd = handlerSource.indexOf("  }", denyStart);
  const denySource = handlerSource.slice(denyStart, denyEnd);

  assert.ok(handlerStart >= 0);
  assert.ok(listenerStart > handlerStart);
  assert.ok(gateStart >= 0);
  assert.ok(denyStart > gateStart);
  assert.match(denySource, /await removePending\(payload\.id\)/);
  assert.match(denySource, /ok: false/);
  assert.doesNotMatch(
    denySource,
    /setConsentVersion|approvePending|launchQueued|chrome\.tabs\.create|runChatGptAdapter/,
  );

  const consentSave = handlerSource.indexOf(
    "await getSettingsStore().setConsentVersion(CONSENT_VERSION)",
    denyEnd,
  );
  const queue = handlerSource.indexOf(
    "const queued = approvePending(payload",
    denyEnd,
  );
  const launch = handlerSource.indexOf(
    "void launchQueued(payload.id)",
    denyEnd,
  );
  assert.ok(consentSave > denyEnd);
  assert.ok(queue > consentSave);
  assert.ok(launch > queue);
});

test("explicit reject は permission / consent / target handoff を通らず pending を削除する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  const handlerStart = source.indexOf("async function handleSettingsMessage");
  const listenerStart = source.indexOf(
    "function registerListeners",
    handlerStart,
  );
  const handlerSource = source.slice(handlerStart, listenerStart);
  const rejectStart = handlerSource.indexOf(
    "if (message.type === SETTINGS_MESSAGE_TYPES.rejectPreview)",
  );
  const rejectEnd = handlerSource.indexOf("\n  }", rejectStart) + 4;
  const rejectSource = handlerSource.slice(rejectStart, rejectEnd);

  assert.ok(rejectStart >= 0);
  assert.ok(rejectEnd > rejectStart);
  assert.match(rejectSource, /await removePending\(payload\.id\)/);
  assert.match(rejectSource, /ok: true/);
  assert.doesNotMatch(
    rejectSource,
    /permissions\.remove|hasOptionalPermissions|setConsentVersion|approvePending|launchQueued|chrome\.tabs\.create/,
  );
});

test("consent revoke は関連 tab、optional bundle、consent version、全 pending を順に cleanup する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  const handlerStart = source.indexOf("async function handleSettingsMessage");
  const revokeStart = source.indexOf(
    "if (message.type === SETTINGS_MESSAGE_TYPES.revokeConsent)",
    handlerStart,
  );
  const payloadStart = source.indexOf("\n  const payload =", revokeStart);
  const revokeSource = source.slice(revokeStart, payloadStart);

  assert.ok(handlerStart >= 0);
  assert.ok(revokeStart > handlerStart);
  assert.ok(payloadStart > revokeStart);
  assert.match(revokeSource, /await getPendingStore\(\)\s*\.list\(\)/);
  assert.match(revokeSource, /item\.consentTabId/);
  assert.match(revokeSource, /item\.targetTabId/);
  assert.match(revokeSource, /closeTabSafely\(tabId\)/);
  assert.match(
    revokeSource,
    /await revokeOptionalPermissionBundle\(\s*chrome\.permissions,?\s*\)/,
  );
  assert.match(revokeSource, /await getSettingsStore\(\)\.clearConsent\(\)/);
  assert.match(
    revokeSource,
    /pending\.map\(\(item\) => removePending\(item\.id\)\)/,
  );
  const revokeCall = revokeSource.indexOf(
    "const permissionRevoked = await revokeOptionalPermissionBundle(",
  );
  const clearConsent = revokeSource.indexOf(
    "await getSettingsStore().clearConsent()",
  );
  const pendingCleanup = revokeSource.indexOf(
    "pending.map((item) => removePending(item.id))",
  );
  assert.ok(revokeCall >= 0);
  assert.ok(clearConsent > revokeCall);
  assert.ok(pendingCleanup > clearConsent);
  assert.ok(revokeSource.indexOf("closeTabSafely(tabId)") < revokeCall);
  assert.doesNotMatch(
    revokeSource,
    /launchQueued|approvePending|runChatGptAdapter/,
  );
});

test("consent または target tab close は対応する pending を物理削除する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  const start = source.indexOf("async function handleTabRemoved");
  const end = source.indexOf("function settingsSnapshot", start);
  const closeSource = source.slice(start, end);

  assert.ok(start >= 0);
  assert.ok(end > start);
  assert.match(closeSource, /payload\.consentTabId === tabId/);
  assert.match(closeSource, /payload\.targetTabId === tabId/);
  assert.match(
    closeSource,
    /\.map\(\(payload\) => removePending\(payload\.id\)\)/,
  );
});

test("revoke 後の新規 context-menu handoff は既存 consent を使わず consent page へ戻る", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  const contextStart = source.indexOf("async function handleContextMenu");
  const contextEnd = source.indexOf("function serializeRequest", contextStart);
  const contextSource = source.slice(contextStart, contextEnd);
  const consentCheck = contextSource.indexOf(
    "settings.consentVersion === CONSENT_VERSION",
  );
  const queue = contextSource.indexOf(
    "queueExistingPayload(payload)",
    consentCheck,
  );
  const consentPage = contextSource.indexOf(
    "await openConsentPage(payload)",
    consentCheck,
  );

  assert.ok(contextStart >= 0);
  assert.ok(contextEnd > contextStart);
  assert.ok(consentCheck >= 0);
  assert.ok(queue > consentCheck);
  assert.ok(consentPage > queue);
  assert.match(
    contextSource.slice(consentCheck, consentPage),
    /await hasOptionalPermissions\(\)/,
  );
  assert.match(contextSource.slice(consentPage), /openConsentPage\(payload\)/);
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
  assert.match(targetFlow, /active: true/);
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
  assert.match(source, /disposition === "cleanup-attempted"/);
  assert.match(
    source,
    /async function processTargetTabOnce\([\s\S]*?catch \{[\s\S]*?removePending\(requestIdValue\)/,
  );
});

test("document-not-visible は clipboard fallback より前に固定 feedback と cleanup で終端する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  const processStart = source.indexOf(
    "async function processTargetTabOnceUnsafe",
  );
  const nextFunctionStart = source.indexOf(
    "async function processTargetTabOnce(",
    processStart,
  );
  const processFlow = source.slice(processStart, nextFunctionStart);
  const visibilityGate = processFlow.indexOf(
    'adapterResult?.diagnostics.failureReason === "document-not-visible"',
  );
  const fallbackCall = processFlow.indexOf("await runFallback(");

  assert.ok(processStart >= 0);
  assert.ok(nextFunctionStart > processStart);
  assert.ok(visibilityGate >= 0);
  assert.ok(fallbackCall > visibilityGate);
  const gateSource = processFlow.slice(visibilityGate, fallbackCall);
  assert.match(gateSource, /show\(tabId, \{ kind: "dom-failure" \}\)/);
  assert.match(gateSource, /removePending\(payload\.id\)/);
  assert.doesNotMatch(gateSource, /fallbackCoordinator|writeText|runFallback/);
});

test("Service Worker restart 相当の attempt marker は再実行せず cleanup へ進む", () => {
  const initial = createPendingPayload({
    id: "request-restart-cleanup",
    sourceUrl: "https://x.com/alice/status/42",
    selectionText: "非機密 fixture",
    prompt: "固定 fixture prompt",
    createdAt: 1_000,
    expiresAt: 20_000,
  });
  const queued = approvePending(initial, 1_001);
  assert.ok(queued);
  const claimed = claimPending(queued, "claim-restart", 20, 1_002);
  assert.ok(claimed);
  const attempted = markAdapterAttempted(claimed, 1_003);
  assert.ok(attempted);

  assert.equal(classifyAdapterAttemptDisposition(claimed), "attempt");
  assert.equal(
    classifyAdapterAttemptDisposition(attempted),
    "cleanup-attempted",
  );
});

test("Service Worker diagnostics は本文・識別子を出力対象にしない", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/service-worker.ts"),
    "utf8",
  );
  const adapterStart = source.indexOf("function reportAdapterDiagnostic");
  const fallbackStart = source.indexOf("async function runFallback");
  const diagnosticSource = source.slice(adapterStart, fallbackStart);

  assert.ok(adapterStart >= 0);
  assert.ok(fallbackStart > adapterStart);
  assert.match(diagnosticSource, /status: result\.status/);
  assert.match(diagnosticSource, /failureCategory/);
  assert.match(diagnosticSource, /visibilityState/);
  assert.doesNotMatch(
    diagnosticSource,
    /selectionText|sourceUrl|prompt|clipboardText|requestId|tabId|\.detail/,
  );
});
