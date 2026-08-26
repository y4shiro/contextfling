import assert from "node:assert/strict";
import { test } from "node:test";
import { createPendingPayload } from "../src/state/machine.js";
import { DEFAULT_SETTINGS } from "../src/state/types.js";
import {
  LocalSettingsStore,
  SETTINGS_STORAGE_KEY,
} from "../src/storage/local-store.js";
import {
  PendingSessionStore,
  pendingStorageKey,
} from "../src/storage/session-store.js";
import type { StorageAreaLike } from "../src/storage/types.js";

class MemoryStorageArea implements StorageAreaLike {
  private readonly values = new Map<string, unknown>();

  public async get(
    keys?: string | string[] | null,
  ): Promise<Record<string, unknown>> {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(this.values.entries());
    }
    const requested = typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(
      requested.flatMap((key) =>
        this.values.has(key) ? [[key, this.values.get(key)]] : [],
      ),
    );
  }

  public async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, value);
    }
  }

  public async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
  }
}

function makePayload(id: string, createdAt: number, expiresAt: number) {
  return createPendingPayload({
    id,
    sourceUrl: "https://x.com/alice/status/42",
    selectionText: "hello",
    prompt: "prompt",
    createdAt,
    expiresAt,
  });
}

test("PendingSessionStore は pending だけを session に読み書きする", async () => {
  const area = new MemoryStorageArea();
  const store = new PendingSessionStore(area);
  const first = makePayload("first", 1_000, 2_000);
  const second = makePayload("second", 1_000, 4_000);
  await store.set(first);
  await store.set(second);
  await area.set({
    unrelated: "ignored",
    [pendingStorageKey("corrupt")]: { state: "queued" },
  });

  assert.deepEqual(await store.get("first"), first);
  assert.deepEqual((await store.list()).map((payload) => payload.id).sort(), [
    "first",
    "second",
  ]);
  assert.deepEqual(await store.clearExpired(2_000), ["first"]);
  assert.equal(await store.get("first"), null);
  assert.deepEqual(await store.get("second"), second);
  await store.remove("second");
  assert.equal(await store.get("second"), null);
});

test("LocalSettingsStore は旧 background 設定を無視し consent version だけを維持する", async () => {
  const area = new MemoryStorageArea();
  const store = new LocalSettingsStore(area);
  assert.deepEqual(await store.get(), DEFAULT_SETTINGS);
  await area.set({
    [SETTINGS_STORAGE_KEY]: {
      openInBackground: true,
      consentVersion: "unknown",
    },
  });
  assert.deepEqual(await store.get(), DEFAULT_SETTINGS);
  await area.set({
    [SETTINGS_STORAGE_KEY]: {
      openInBackground: true,
      consentVersion: "chatgpt-web-dom-v1",
      ignoredSetting: "ignored",
    },
  });
  assert.deepEqual(await store.get(), {
    consentVersion: "chatgpt-web-dom-v1",
  });
  const consented = await store.setConsentVersion("chatgpt-web-dom-v1");
  assert.deepEqual(consented, {
    consentVersion: "chatgpt-web-dom-v1",
  });
  assert.deepEqual(
    (await area.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY],
    {
      consentVersion: "chatgpt-web-dom-v1",
    },
  );
  assert.deepEqual(await store.clearConsent(), {
    consentVersion: null,
  });
});
