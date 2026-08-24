import { tryBuildPrompt } from "./core/prompt.js";
import { normalizeSelection } from "./core/selection.js";
import { normalizeXUrl, sanitizeXUrl } from "./core/url.js";
import {
  type ChatGptAdapterResult,
  type ChatGptAdapterStatus,
  createChatGptAdapterInput,
  runChatGptAdapter,
} from "./destinations/chatgpt/adapter.js";
import {
  type ChatGptBannerInput,
  showChatGptBanner,
} from "./destinations/chatgpt/banner.js";
import {
  createClipboardFallbackCoordinator,
  type FallbackBannerPort,
  type OffscreenClipboardPort,
} from "./handoff/fallback.js";
import type { ClipboardWriteResponse } from "./offscreen/clipboard.js";
import { OPTIONAL_PERMISSION_BUNDLE } from "./settings/permissions.js";
import {
  isSettingsMessage,
  type RuntimeResponse,
  SETTINGS_MESSAGE_TYPES,
  type SettingsMessage,
} from "./settings/settings.js";
import { extractNearestStatusUrl } from "./sources/x/extractor.js";
import {
  approvePending,
  attachConsentTab,
  attachTargetTab,
  claimPending,
  createPendingPayload,
  isClaimable,
  markAdapterAttempted,
} from "./state/machine.js";
import {
  CONSENT_VERSION,
  DEFAULT_SETTINGS,
  PENDING_TTL_MS,
  type PendingPayload,
} from "./state/types.js";
import { LocalSettingsStore } from "./storage/local-store.js";
import { PendingSessionStore } from "./storage/session-store.js";
import type { StorageAreaLike } from "./storage/types.js";

const MENU_ID = "contextfling-explain-selection";
const CHATGPT_URL = "https://chatgpt.com/";
const SETTINGS_PATH = "settings/settings.html";
const MENU_DOCUMENT_URL_PATTERNS = [
  "https://x.com/*",
  "https://www.x.com/*",
  "https://twitter.com/*",
  "https://www.twitter.com/*",
];

const requestOperations = new Map<string, Promise<void>>();

function getPendingStore(): PendingSessionStore {
  return new PendingSessionStore(
    chrome.storage.session as unknown as StorageAreaLike,
  );
}

function getSettingsStore(): LocalSettingsStore {
  return new LocalSettingsStore(
    chrome.storage.local as unknown as StorageAreaLike,
  );
}

function requestId(): string {
  try {
    return `request-${crypto.randomUUID()}`;
  } catch {
    return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function isValidTabId(tabId: number | undefined): tabId is number {
  return Number.isInteger(tabId) && (tabId as number) >= 0;
}

function extensionSettingsUrl(id?: string): string {
  const url = chrome.runtime.getURL(SETTINGS_PATH);
  return id ? `${url}?requestId=${encodeURIComponent(id)}` : url;
}

function isSettingsPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== undefined && sender.id !== chrome.runtime.id) {
    return false;
  }
  if (typeof sender.url !== "string") {
    return false;
  }
  try {
    const parsed = new URL(sender.url);
    return (
      parsed.protocol === "chrome-extension:" &&
      parsed.hostname === chrome.runtime.id &&
      parsed.pathname === `/${SETTINGS_PATH}`
    );
  } catch {
    return false;
  }
}

function isSenderForConsentTab(
  sender: chrome.runtime.MessageSender,
  payload: PendingPayload,
): boolean {
  return (
    isSettingsPageSender(sender) &&
    (payload.consentTabId === undefined ||
      sender.tab?.id === payload.consentTabId)
  );
}

function sendRuntimeResponse(
  sendResponse: (value: RuntimeResponse) => void,
  value: RuntimeResponse,
): void {
  try {
    sendResponse(value);
  } catch {
    // The settings tab may have been closed while the worker was waiting.
  }
}

async function removePending(id: string): Promise<void> {
  await getPendingStore()
    .remove(id)
    .catch(() => undefined);
}

async function closeTabSafely(tabId: number | undefined): Promise<void> {
  if (!isValidTabId(tabId)) {
    return;
  }
  await chrome.tabs.remove(tabId).catch(() => undefined);
}

async function hasOptionalPermissions(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(OPTIONAL_PERMISSION_BUNDLE);
  } catch {
    return false;
  }
}

async function clearExpiredPending(): Promise<void> {
  await getPendingStore()
    .clearExpired(Date.now())
    .catch(() => undefined);
}

async function createContextMenu(): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      // removeAll is callback-based on Chrome versions supported by v0.1.
      chrome.contextMenus.removeAll(() => resolve());
    } catch {
      resolve();
    }
  });
  try {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "ChatGPTで解説する",
      contexts: ["selection"],
      documentUrlPatterns: MENU_DOCUMENT_URL_PATTERNS,
    });
  } catch {
    // Menu registration failure contains no pending user data to preserve.
  }
}

async function extractSourceUrl(
  tabId: number,
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab,
): Promise<string | null> {
  const pageUrl = tab.url ?? info.pageUrl ?? info.frameUrl ?? "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [info.frameId ?? 0] },
      func: extractNearestStatusUrl,
      world: "ISOLATED",
    });
    const candidate = results[0]?.result;
    if (typeof candidate === "string") {
      const normalizedCandidate = normalizeXUrl(candidate)?.value;
      if (normalizedCandidate) {
        return normalizedCandidate;
      }
    }
  } catch {
    // Protected pages/frames fall through to the same URL validation boundary.
  }
  return sanitizeXUrl(pageUrl);
}

async function openConsentPage(payload: PendingPayload): Promise<void> {
  const store = getPendingStore();
  let consentTabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({
      url: "about:blank",
      active: true,
    });
    if (!isValidTabId(tab.id)) {
      await removePending(payload.id);
      return;
    }
    consentTabId = tab.id;
    const withConsentTab = attachConsentTab(payload, tab.id, Date.now());
    if (!withConsentTab) {
      await removePending(payload.id);
      return;
    }
    await store.set(withConsentTab);
    await chrome.tabs.update(tab.id, {
      url: extensionSettingsUrl(payload.id),
    });
  } catch {
    await removePending(payload.id);
    await closeTabSafely(consentTabId);
  }
}

async function queueExistingPayload(payload: PendingPayload): Promise<boolean> {
  const queued = approvePending(payload, Date.now());
  if (!queued) {
    return false;
  }
  try {
    await getPendingStore().set(queued);
    void launchQueued(payload.id).catch(() => undefined);
    return true;
  } catch {
    await removePending(payload.id);
    return false;
  }
}

async function handleContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  if (info.menuItemId !== MENU_ID || !tab || !isValidTabId(tab.id)) {
    return;
  }
  const selectionText = normalizeSelection(info.selectionText);
  if (!selectionText) {
    return;
  }
  await clearExpiredPending();
  const sourceUrl = await extractSourceUrl(tab.id, info, tab);
  if (!sourceUrl) {
    return;
  }
  const prompt = tryBuildPrompt(sourceUrl, selectionText);
  if (!prompt) {
    return;
  }
  const createdAt = Date.now();
  const payload = createPendingPayload({
    id: requestId(),
    sourceUrl,
    selectionText,
    prompt,
    createdAt,
    expiresAt: createdAt + PENDING_TTL_MS,
  });
  const store = getPendingStore();
  try {
    await store.set(payload);
    const settings = await getSettingsStore().get();
    if (
      settings.consentVersion === CONSENT_VERSION &&
      (await hasOptionalPermissions())
    ) {
      if (!(await queueExistingPayload(payload))) {
        await removePending(payload.id);
      }
      return;
    }
    await openConsentPage(payload);
  } catch {
    await removePending(payload.id);
  }
}

function serializeRequest(
  id: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = requestOperations.get(id) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const tracked = next.finally(() => {
    if (requestOperations.get(id) === tracked) {
      requestOperations.delete(id);
    }
  });
  requestOperations.set(id, tracked);
  return tracked;
}

function isClipboardWriteResponse(
  value: unknown,
): value is ClipboardWriteResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.ok === true ||
    (record.ok === false &&
      (record.reason === "invalid-request" ||
        record.reason === "duplicate-request" ||
        record.reason === "clipboard-unavailable" ||
        record.reason === "write-failed" ||
        record.reason === "response-failed"))
  );
}

function createOffscreenPort(): OffscreenClipboardPort {
  return {
    hasDocument: async (): Promise<boolean> => {
      try {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          documentUrls: [chrome.runtime.getURL("offscreen.html")],
        });
        return contexts.length > 0;
      } catch {
        return false;
      }
    },
    createDocument: async (): Promise<void> => {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: "自動入力失敗時のプロンプトを一度だけコピーします。",
      });
    },
    closeDocument: async (): Promise<void> => {
      await chrome.offscreen.closeDocument();
    },
    writeText: async (request): Promise<ClipboardWriteResponse> => {
      try {
        const value: unknown = await chrome.runtime.sendMessage(request);
        return isClipboardWriteResponse(value)
          ? value
          : { ok: false, reason: "response-failed" };
      } catch {
        return { ok: false, reason: "response-failed" };
      }
    },
  };
}

function createBannerPort(): FallbackBannerPort {
  return {
    show: async (tabId: number, input: ChatGptBannerInput): Promise<void> => {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: showChatGptBanner,
        args: [input],
        world: "ISOLATED",
      });
    },
  };
}

const fallbackCoordinator = createClipboardFallbackCoordinator({
  offscreen: createOffscreenPort(),
  banner: createBannerPort(),
});

function isAdapterStatus(value: unknown): value is ChatGptAdapterStatus {
  return (
    value === "sent" ||
    value === "invalid-input" ||
    value === "not-logged-in" ||
    value === "selector-mismatch" ||
    value === "timeout" ||
    value === "send-unknown"
  );
}

function isAdapterResult(value: unknown): value is ChatGptAdapterResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isAdapterStatus(record.status) &&
    (record.phase === "validate" ||
      record.phase === "composer" ||
      record.phase === "send") &&
    typeof record.attempted === "boolean" &&
    typeof record.detail === "string"
  );
}

async function runFallback(
  payload: PendingPayload,
  tabId: number,
  cause: Exclude<ChatGptAdapterStatus, "sent" | "invalid-input">,
): Promise<void> {
  try {
    await fallbackCoordinator.run({
      requestId: payload.id,
      tabId,
      prompt: payload.prompt,
      cause,
    });
  } finally {
    await removePending(payload.id);
  }
}

async function processTargetTabOnceUnsafe(
  requestIdValue: string,
): Promise<void> {
  const store = getPendingStore();
  const payload = await store.get(requestIdValue);
  if (!payload) {
    return;
  }
  if (
    payload.state !== "injecting" ||
    payload.targetTabId === undefined ||
    payload.adapterAttemptedAt !== undefined
  ) {
    return;
  }
  const tabId = payload.targetTabId;
  if (Date.now() >= payload.expiresAt || !(await hasOptionalPermissions())) {
    await removePending(payload.id);
    return;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith(CHATGPT_URL)) {
      await removePending(payload.id);
      return;
    }
  } catch {
    await removePending(payload.id);
    return;
  }

  const attempted = markAdapterAttempted(payload, Date.now());
  if (!attempted) {
    return;
  }
  try {
    await store.set(attempted);
  } catch {
    await removePending(payload.id);
    return;
  }

  let adapterResult: ChatGptAdapterResult | null = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: runChatGptAdapter,
      args: [createChatGptAdapterInput(payload.prompt)],
      world: "ISOLATED",
    });
    const value = results[0]?.result;
    adapterResult = isAdapterResult(value) ? value : null;
  } catch {
    adapterResult = null;
  }
  if (adapterResult?.status === "sent") {
    await removePending(payload.id);
    return;
  }
  if (adapterResult?.status === "invalid-input") {
    await createBannerPort()
      .show(tabId, { kind: "dom-failure" })
      .catch(() => undefined);
    await removePending(payload.id);
    return;
  }
  const cause: Exclude<ChatGptAdapterStatus, "sent" | "invalid-input"> =
    adapterResult?.status ?? "selector-mismatch";
  await runFallback(attempted, tabId, cause);
}

async function processTargetTabOnce(requestIdValue: string): Promise<void> {
  try {
    await processTargetTabOnceUnsafe(requestIdValue);
  } catch {
    // Any unexpected storage/API failure is terminal for this one-shot
    // request. Do not leave an injecting payload waiting for a retry.
    await removePending(requestIdValue);
  }
}

function processTargetTab(requestIdValue: string): Promise<void> {
  return serializeRequest(requestIdValue, () =>
    processTargetTabOnce(requestIdValue),
  );
}

async function launchQueuedOnce(requestIdValue: string): Promise<void> {
  const store = getPendingStore();
  const payload = await store.get(requestIdValue);
  if (!payload || !isClaimable(payload, Date.now())) {
    if (payload && Date.now() >= payload.expiresAt) {
      await removePending(requestIdValue);
    }
    return;
  }
  const settings = await getSettingsStore().get();
  if (
    settings.consentVersion !== CONSENT_VERSION ||
    !(await hasOptionalPermissions())
  ) {
    await removePending(requestIdValue);
    return;
  }
  const claimed = claimPending(payload, requestId(), undefined, Date.now());
  if (!claimed) {
    return;
  }
  await store.set(claimed);
  let target: chrome.tabs.Tab;
  try {
    target = await chrome.tabs.create({
      url: "about:blank",
      active: !settings.openInBackground,
    });
  } catch {
    await removePending(requestIdValue);
    return;
  }
  if (!isValidTabId(target.id)) {
    await removePending(requestIdValue);
    return;
  }
  const withTarget = attachTargetTab(claimed, target.id, Date.now());
  if (!withTarget) {
    await removePending(requestIdValue);
    await closeTabSafely(target.id);
    return;
  }
  await store.set(withTarget);
  try {
    await chrome.tabs.update(target.id, { url: CHATGPT_URL });
  } catch {
    await removePending(requestIdValue);
    await closeTabSafely(target.id);
  }
}

async function launchQueued(requestIdValue: string): Promise<void> {
  try {
    await serializeRequest(requestIdValue, () =>
      launchQueuedOnce(requestIdValue),
    );
  } catch {
    // Queue/claim/storage failures must not strand the request in queued or
    // injecting state. The cleanup helper is itself best effort.
    await removePending(requestIdValue);
  }
}

async function findPendingForTargetTab(
  tabId: number,
): Promise<PendingPayload | null> {
  await clearExpiredPending();
  const pending = await getPendingStore().list();
  return (
    pending.find(
      (payload) =>
        payload.state === "injecting" && payload.targetTabId === tabId,
    ) ?? null
  );
}

async function handleTargetTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
): Promise<void> {
  if (changeInfo.status !== "complete") {
    return;
  }
  const payload = await findPendingForTargetTab(tabId);
  if (payload) {
    void processTargetTab(payload.id).catch(() => undefined);
  }
}

async function handleTabRemoved(tabId: number): Promise<void> {
  const pending = await getPendingStore()
    .list()
    .catch(() => []);
  await Promise.all(
    pending
      .filter(
        (payload) =>
          payload.consentTabId === tabId || payload.targetTabId === tabId,
      )
      .map((payload) => removePending(payload.id)),
  );
}

function settingsSnapshot(
  settings: Awaited<ReturnType<LocalSettingsStore["get"]>>,
) {
  return {
    consentVersion: settings.consentVersion,
    openInBackground: settings.openInBackground,
  };
}

async function handleSettingsMessage(
  message: SettingsMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (value: RuntimeResponse) => void,
): Promise<void> {
  if (message.type === SETTINGS_MESSAGE_TYPES.getSettings) {
    const settings = await getSettingsStore().get();
    sendRuntimeResponse(sendResponse, {
      ok: true,
      settings: settingsSnapshot(settings),
    });
    return;
  }
  if (message.type === SETTINGS_MESSAGE_TYPES.updateSettings) {
    try {
      const settings = await getSettingsStore().setOpenInBackground(
        message.openInBackground,
      );
      sendRuntimeResponse(sendResponse, {
        ok: true,
        settings: settingsSnapshot(settings),
      });
    } catch {
      sendRuntimeResponse(sendResponse, {
        ok: false,
        message: "設定を保存できませんでした。",
      });
    }
    return;
  }
  if (message.type === SETTINGS_MESSAGE_TYPES.revokeConsent) {
    const pending = await getPendingStore()
      .list()
      .catch(() => []);
    await Promise.all(
      pending.flatMap((item) =>
        [item.consentTabId, item.targetTabId]
          .filter(isValidTabId)
          .map((tabId) => closeTabSafely(tabId)),
      ),
    );
    try {
      await chrome.permissions.remove(OPTIONAL_PERMISSION_BUNDLE);
    } catch {
      // The setting is cleared even if the permission was already absent.
    }
    await getSettingsStore().clearConsent();
    await Promise.all(pending.map((item) => removePending(item.id)));
    sendRuntimeResponse(sendResponse, { ok: true, consentGranted: false });
    return;
  }

  const payload =
    "requestId" in message
      ? await getPendingStore().get(message.requestId)
      : null;
  if (!payload || !isSenderForConsentTab(sender, payload)) {
    sendRuntimeResponse(sendResponse, {
      ok: false,
      message: "プレビューを確認できません。",
    });
    return;
  }
  if (Date.now() >= payload.expiresAt) {
    await removePending(payload.id);
    sendRuntimeResponse(sendResponse, {
      ok: false,
      message: "プレビューの有効期限が切れています。",
    });
    return;
  }
  if (message.type === SETTINGS_MESSAGE_TYPES.getPreview) {
    if (payload.state !== "awaitingConsent") {
      sendRuntimeResponse(sendResponse, {
        ok: false,
        message: "プレビューを確認できません。",
      });
      return;
    }
    sendRuntimeResponse(sendResponse, {
      ok: true,
      preview: {
        destination: CHATGPT_URL,
        prompt: payload.prompt,
        selectionText: payload.selectionText,
        sourceUrl: payload.sourceUrl,
      },
    });
    return;
  }
  if (message.type === SETTINGS_MESSAGE_TYPES.rejectPreview) {
    await removePending(payload.id);
    sendRuntimeResponse(sendResponse, {
      ok: true,
      message: "送信せずに破棄しました。",
    });
    return;
  }

  // The settings click handler requests the optional bundle directly. The
  // worker only performs the authoritative `contains` check before queuing.
  const permissionGranted = await hasOptionalPermissions();
  if (!permissionGranted) {
    await removePending(payload.id);
    sendRuntimeResponse(sendResponse, {
      ok: false,
      message: "必要な権限が許可されなかったため、送信せず破棄しました。",
    });
    return;
  }
  await getSettingsStore().setConsentVersion(CONSENT_VERSION);
  const queued = approvePending(payload, Date.now());
  if (!queued) {
    await removePending(payload.id);
    sendRuntimeResponse(sendResponse, {
      ok: false,
      message: "送信を開始できませんでした。",
    });
    return;
  }
  await getPendingStore().set(queued);
  await closeTabSafely(payload.consentTabId ?? sender.tab?.id);
  sendRuntimeResponse(sendResponse, { ok: true, consentGranted: true });
  void launchQueued(payload.id).catch(() => undefined);
}

function registerListeners(): void {
  chrome.runtime.onInstalled.addListener((details) => {
    void createContextMenu();
    if (details.reason === "install") {
      void getSettingsStore()
        .set(DEFAULT_SETTINGS)
        .catch(() => undefined);
    }
    void clearExpiredPending();
  });
  chrome.runtime.onStartup.addListener(() => {
    void clearExpiredPending();
  });
  chrome.action.onClicked.addListener(() => {
    void chrome.runtime.openOptionsPage().catch(() => undefined);
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleContextMenu(info, tab).catch(() => undefined);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    void handleTargetTabUpdated(tabId, changeInfo).catch(() => undefined);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void handleTabRemoved(tabId).catch(() => undefined);
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isSettingsPageSender(sender) || !isSettingsMessage(message)) {
      return false;
    }
    void handleSettingsMessage(message, sender, sendResponse).catch(() =>
      sendRuntimeResponse(sendResponse, {
        ok: false,
        message: "拡張機能との通信に失敗しました。",
      }),
    );
    return true;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime) {
  registerListeners();
}

export {
  CHATGPT_URL,
  isSettingsPageSender,
  MENU_DOCUMENT_URL_PATTERNS,
  MENU_ID,
  OPTIONAL_PERMISSION_BUNDLE,
};
