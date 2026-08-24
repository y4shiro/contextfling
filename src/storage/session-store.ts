import { isExpired } from "../state/machine.js";
import { isPendingPayload, type PendingPayload } from "../state/types.js";
import type { StorageAreaLike } from "./types.js";

export const PENDING_STORAGE_PREFIX = "contextfling.pending.";

export function pendingStorageKey(requestId: string): string {
  return `${PENDING_STORAGE_PREFIX}${requestId}`;
}

/**
 * storage.session の pending wrapper。
 * claim の compare-and-swap は実装しない。read→claimPending→set は caller が
 * request ID 単位で直列化して使用する必要がある。
 */
export class PendingSessionStore {
  private readonly area: StorageAreaLike;

  public constructor(area: StorageAreaLike) {
    this.area = area;
  }

  public async get(requestId: string): Promise<PendingPayload | null> {
    if (requestId.trim().length === 0) {
      return null;
    }
    const values = await this.area.get(pendingStorageKey(requestId));
    const payload = values[pendingStorageKey(requestId)];
    return isPendingPayload(payload) && payload.id === requestId
      ? payload
      : null;
  }

  public async set(payload: PendingPayload): Promise<void> {
    if (!isPendingPayload(payload)) {
      throw new TypeError("Invalid pending payload");
    }
    await this.area.set({ [pendingStorageKey(payload.id)]: payload });
  }

  public async remove(requestId: string): Promise<void> {
    if (requestId.trim().length === 0) {
      return;
    }
    await this.area.remove(pendingStorageKey(requestId));
  }

  public async list(): Promise<PendingPayload[]> {
    const values = await this.area.get(null);
    const pending: PendingPayload[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(PENDING_STORAGE_PREFIX) || !isPendingPayload(value)) {
        continue;
      }
      if (pendingStorageKey(value.id) !== key) {
        continue;
      }
      pending.push(value);
    }
    return pending;
  }

  public async clearExpired(now = Date.now()): Promise<string[]> {
    const expiredIds = (await this.list())
      .filter((payload) => isExpired(payload, now))
      .map((payload) => payload.id);
    if (expiredIds.length > 0) {
      await this.area.remove(expiredIds.map(pendingStorageKey));
    }
    return expiredIds;
  }
}

export type SessionStore = PendingSessionStore;
