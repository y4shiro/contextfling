import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ChatGptAdapterFailureReason,
  ChatGptAdapterResult,
  ChatGptAdapterStatus,
} from "../src/destinations/chatgpt/adapter.js";
import {
  approvePending,
  attachConsentTab,
  attachTargetTab,
  claimPending,
  createPendingPayload,
  markAdapterAttempted,
} from "../src/state/machine.js";
import type { PendingPayload } from "../src/state/types.js";
import {
  PendingSessionStore,
  pendingStorageKey,
} from "../src/storage/session-store.js";
import type { StorageAreaLike } from "../src/storage/types.js";

type ServiceWorkerModule = typeof import("../src/service-worker.js");

type ExecuteScriptDetails = {
  readonly args?: readonly unknown[];
  readonly func?: unknown;
};

type FakeTab = {
  readonly id: number;
  readonly url: string;
};

type ListenerEvent = {
  addListener(listener: (...args: never[]) => unknown): void;
};

function createListenerEvent(): ListenerEvent {
  return {
    addListener: (_listener) => undefined,
  };
}

class MemoryStorageArea implements StorageAreaLike {
  private readonly values = new Map<string, unknown>();

  public async get(
    keys?: string | string[] | null,
  ): Promise<Record<string, unknown>> {
    if (keys === undefined || keys === null) {
      return Object.fromEntries(this.values);
    }
    const requested = typeof keys === "string" ? [keys] : keys;
    const result: Record<string, unknown> = {};
    for (const key of requested) {
      if (this.values.has(key)) {
        result[key] = this.values.get(key);
      }
    }
    return result;
  }

  public async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, value);
    }
  }

  public async remove(keys: string | string[]): Promise<void> {
    const requested = typeof keys === "string" ? [keys] : keys;
    for (const key of requested) {
      this.values.delete(key);
    }
  }

  public value(key: string): unknown {
    return this.values.get(key);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class FakeChromeHarness {
  public readonly session = new MemoryStorageArea();

  public readonly targetTabs = new Map<number, FakeTab>();

  public readonly executeScriptCalls: ExecuteScriptDetails[] = [];

  public adapterCallCount = 0;

  public clipboardWriteCount = 0;

  public markerObservedBeforeExecute = false;

  private trackedPendingKey: string | undefined;

  public readonly chrome: unknown;

  public constructor(private readonly adapterResult: ChatGptAdapterResult) {
    this.chrome = {
      runtime: {
        ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
        id: "test-extension",
        getContexts: async () => [{ contextType: "OFFSCREEN_DOCUMENT" }],
        getURL: (path: string) => `chrome-extension://test-extension/${path}`,
        onInstalled: createListenerEvent(),
        onMessage: createListenerEvent(),
        onStartup: createListenerEvent(),
        openOptionsPage: async () => undefined,
        sendMessage: async () => {
          this.clipboardWriteCount += 1;
          return { ok: true };
        },
      },
      storage: {
        local: new MemoryStorageArea(),
        session: this.session,
      },
      permissions: {
        contains: async () => true,
        remove: async () => true,
      },
      tabs: {
        create: async () => ({ id: 999, url: "about:blank" }),
        get: async (tabId: number) => {
          const tab = this.targetTabs.get(tabId);
          if (!tab) {
            throw new Error(`Unknown synthetic tab: ${tabId}`);
          }
          return tab;
        },
        onRemoved: createListenerEvent(),
        onUpdated: createListenerEvent(),
        remove: async (tabId: number) => {
          this.targetTabs.delete(tabId);
        },
        update: async (
          tabId: number,
          properties: { readonly url?: string },
        ) => {
          const tab = this.targetTabs.get(tabId);
          if (tab && properties.url !== undefined) {
            this.targetTabs.set(tabId, { ...tab, url: properties.url });
          }
          return tab;
        },
      },
      scripting: {
        executeScript: this.executeScript,
      },
      contextMenus: {
        create: () => undefined,
        onClicked: createListenerEvent(),
        removeAll: (callback: () => void) => callback(),
      },
      action: {
        onClicked: createListenerEvent(),
      },
      offscreen: {
        Reason: { CLIPBOARD: "CLIPBOARD" },
        closeDocument: async () => undefined,
        createDocument: async () => undefined,
      },
    } as unknown as typeof chrome;
  }

  public readonly executeScript = async (
    details: ExecuteScriptDetails,
  ): Promise<readonly [{ readonly result: unknown }]> => {
    this.executeScriptCalls.push(details);
    const firstArg = details.args?.[0];
    if (isRecord(firstArg) && Object.hasOwn(firstArg, "selectors")) {
      this.adapterCallCount += 1;
      const stored =
        this.trackedPendingKey === undefined
          ? undefined
          : this.session.value(this.trackedPendingKey);
      this.markerObservedBeforeExecute =
        isRecord(stored) && typeof stored.adapterAttemptedAt === "number";
    }
    return [{ result: this.adapterResult }];
  };

  public install(): () => void {
    const globalObject = globalThis as unknown as Record<string, unknown>;
    const hadChrome = Object.hasOwn(globalObject, "chrome");
    const previousChrome = globalObject.chrome;
    Object.defineProperty(globalObject, "chrome", {
      configurable: true,
      value: this.chrome,
      writable: true,
    });
    return () => {
      if (hadChrome) {
        Object.defineProperty(globalObject, "chrome", {
          configurable: true,
          value: previousChrome,
          writable: true,
        });
      } else {
        delete globalObject.chrome;
      }
    };
  }

  public trackPending(requestId: string): void {
    this.trackedPendingKey = pendingStorageKey(requestId);
  }
}

let serviceWorkerPromise: Promise<ServiceWorkerModule> | undefined;

async function loadServiceWorker(): Promise<ServiceWorkerModule> {
  serviceWorkerPromise ??= import("../src/service-worker.js");
  return serviceWorkerPromise;
}

function syntheticAdapterResult(
  status: ChatGptAdapterStatus,
): ChatGptAdapterResult {
  const failureReason: ChatGptAdapterFailureReason =
    status === "selector-mismatch"
      ? "composer-not-found"
      : status === "timeout"
        ? "composer-timeout"
        : "send-result-unknown";
  const phase: ChatGptAdapterResult["phase"] =
    status === "selector-mismatch" || status === "timeout"
      ? "composer"
      : "send";
  return {
    status,
    phase,
    attempted: true,
    detail: "synthetic fixture result",
    diagnostics: {
      visibilityState: "visible",
      failureReason: status === "sent" ? "none" : failureReason,
      composerCandidateCount: 1,
      sendCandidateCount: 1,
      attachment: {
        composer: "attached",
        container: "attached",
        send: "attached",
      },
    },
  };
}

function createInjectingPayload(
  id: string,
  targetTabId: number,
  adapterAttemptedAt?: number,
): PendingPayload {
  const now = Date.now();
  const initial = createPendingPayload({
    id,
    sourceUrl: "https://x.com/example/status/123",
    selectionText: "synthetic fixture text",
    prompt: "synthetic fixture prompt",
    createdAt: now - 1_000,
    expiresAt: now + 60_000,
  });
  const queued = approvePending(initial, now - 900);
  assert.ok(queued);
  const claimed = claimPending(queued, `claim-${id}`, undefined, now - 800);
  assert.ok(claimed);
  const attached = attachTargetTab(claimed, targetTabId, now - 700);
  assert.ok(attached);
  if (adapterAttemptedAt === undefined) {
    return attached;
  }
  const attempted = markAdapterAttempted(attached, adapterAttemptedAt);
  assert.ok(attempted);
  return attempted;
}

async function persistPayload(
  harness: FakeChromeHarness,
  payload: PendingPayload,
): Promise<PendingSessionStore> {
  harness.trackPending(payload.id);
  const store = new PendingSessionStore(harness.session);
  await store.set(payload);
  return store;
}

function fakeTab(targetTabId: number, url: string): FakeTab {
  return { id: targetTabId, url };
}

function targetTab(targetTabId: number, url: string): chrome.tabs.Tab {
  return fakeTab(targetTabId, url) as unknown as chrome.tabs.Tab;
}

test("about:blank complete を保留し、ChatGPT complete の重複更新でも adapter は一度だけ実行する", async () => {
  const harness = new FakeChromeHarness(syntheticAdapterResult("sent"));
  const restoreChrome = harness.install();
  try {
    const serviceWorker = await loadServiceWorker();
    const targetTabId = 11;
    const payload = createInjectingPayload(
      "request-regression-ready",
      targetTabId,
    );
    const store = await persistPayload(harness, payload);
    harness.targetTabs.set(targetTabId, fakeTab(targetTabId, "about:blank"));

    await serviceWorker.handleTargetTabUpdated(
      targetTabId,
      { status: "complete", url: "about:blank" },
      targetTab(targetTabId, serviceWorker.CHATGPT_URL),
    );
    assert.equal(harness.adapterCallCount, 0);
    assert.ok(await store.get(payload.id));

    const chatGptUrl = serviceWorker.CHATGPT_URL;
    harness.targetTabs.set(targetTabId, fakeTab(targetTabId, chatGptUrl));
    const firstUpdate = serviceWorker.handleTargetTabUpdated(
      targetTabId,
      { status: "complete", url: chatGptUrl },
      targetTab(targetTabId, "about:blank"),
    );
    const duplicateUpdate = serviceWorker.handleTargetTabUpdated(
      targetTabId,
      { status: "complete", url: chatGptUrl },
      targetTab(targetTabId, "about:blank"),
    );
    await Promise.all([firstUpdate, duplicateUpdate]);

    assert.equal(harness.adapterCallCount, 1);
    assert.equal(harness.markerObservedBeforeExecute, true);
    assert.equal(await store.get(payload.id), null);
  } finally {
    restoreChrome();
  }
});

test("保存済み adapterAttemptedAt は Service Worker 再起動相当で再実行せず cleanup する", async () => {
  const harness = new FakeChromeHarness(syntheticAdapterResult("sent"));
  const restoreChrome = harness.install();
  try {
    const serviceWorker = await loadServiceWorker();
    const targetTabId = 12;
    const attemptedAt = Date.now();
    const payload = createInjectingPayload(
      "request-regression-restart",
      targetTabId,
      attemptedAt,
    );
    const store = await persistPayload(harness, payload);
    const chatGptUrl = serviceWorker.CHATGPT_URL;
    harness.targetTabs.set(targetTabId, fakeTab(targetTabId, chatGptUrl));

    await serviceWorker.handleTargetTabUpdated(
      targetTabId,
      { status: "complete", url: chatGptUrl },
      targetTab(targetTabId, chatGptUrl),
    );

    assert.equal(harness.adapterCallCount, 0);
    assert.equal(await store.get(payload.id), null);
  } finally {
    restoreChrome();
  }
});

test("target tab または consent tab の close は対応する pending だけを削除する", async () => {
  const harness = new FakeChromeHarness(syntheticAdapterResult("sent"));
  const restoreChrome = harness.install();
  try {
    const serviceWorker = await loadServiceWorker();
    const store = new PendingSessionStore(harness.session);
    const targetPayload = createInjectingPayload(
      "request-regression-target-close",
      21,
    );
    const consentInitial = createPendingPayload({
      id: "request-regression-consent-close",
      sourceUrl: "https://x.com/example/status/456",
      selectionText: "synthetic consent fixture",
      prompt: "synthetic consent prompt",
      createdAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000,
    });
    const consentPayload = attachConsentTab(
      consentInitial,
      22,
      Date.now() - 900,
    );
    assert.ok(consentPayload);
    await persistPayload(harness, targetPayload);
    await persistPayload(harness, consentPayload);

    await serviceWorker.handleTabRemoved(21);
    assert.equal(await store.get(targetPayload.id), null);
    assert.ok(await store.get(consentPayload.id));

    await serviceWorker.handleTabRemoved(22);
    assert.equal(await store.get(consentPayload.id), null);
  } finally {
    restoreChrome();
  }
});

test("selector-mismatch/timeout/send-unknown 後の同一更新は adapter を再実行しない", async () => {
  const statuses = ["selector-mismatch", "timeout", "send-unknown"] as const;
  const serviceWorker = await loadServiceWorker();

  for (const [index, status] of statuses.entries()) {
    const harness = new FakeChromeHarness(syntheticAdapterResult(status));
    const restoreChrome = harness.install();
    try {
      const targetTabId = 30 + index;
      const payload = createInjectingPayload(
        `request-regression-${status}`,
        targetTabId,
      );
      const store = await persistPayload(harness, payload);
      const chatGptUrl = serviceWorker.CHATGPT_URL;
      harness.targetTabs.set(targetTabId, fakeTab(targetTabId, chatGptUrl));

      await serviceWorker.handleTargetTabUpdated(
        targetTabId,
        { status: "complete", url: chatGptUrl },
        targetTab(targetTabId, chatGptUrl),
      );
      assert.equal(harness.adapterCallCount, 1, status);
      assert.equal(harness.clipboardWriteCount, 1, status);
      assert.equal(await store.get(payload.id), null, status);

      await serviceWorker.handleTargetTabUpdated(
        targetTabId,
        { status: "complete", url: chatGptUrl },
        targetTab(targetTabId, chatGptUrl),
      );
      assert.equal(harness.adapterCallCount, 1, status);
      assert.equal(harness.clipboardWriteCount, 1, status);
    } finally {
      restoreChrome();
    }
  }
});
