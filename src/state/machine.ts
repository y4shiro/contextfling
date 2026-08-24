import {
  isPendingPayload,
  PENDING_TTL_MS,
  type PendingPayload,
  type PendingState,
} from "./types.js";

export type PendingTransition =
  | { readonly type: "approve" }
  | {
      readonly type: "claim";
      readonly claimId: string;
      readonly targetTabId?: number;
    }
  | {
      readonly type: "attach-target";
      readonly targetTabId: number;
    }
  | {
      readonly type: "attach-consent-tab";
      readonly consentTabId: number;
    }
  | {
      readonly type: "mark-adapter-attempted";
      readonly attemptedAt?: number;
    }
  | { readonly type: "terminal" };

export function isExpired(payload: PendingPayload, now = Date.now()): boolean {
  return !Number.isFinite(now) || now >= payload.expiresAt;
}

export function isClaimable(
  payload: PendingPayload,
  now = Date.now(),
): boolean {
  return payload.state === "queued" && !isExpired(payload, now);
}

export function approvePending(
  payload: PendingPayload,
  now = Date.now(),
): PendingPayload | null {
  return transitionPending(payload, { type: "approve" }, now);
}

/**
 * queued の claim は純粋な read/validate/write 用 helper。
 * chrome.storage に CAS はないため、呼び出し側が request ID ごとにこの操作を直列化する。
 */
export function claimPending(
  payload: PendingPayload,
  claimId: string,
  targetTabId?: number,
  now = Date.now(),
): PendingPayload | null {
  return transitionPending(
    payload,
    {
      type: "claim",
      claimId,
      ...(targetTabId === undefined ? {} : { targetTabId }),
    },
    now,
  );
}

export function transitionPending(
  payload: PendingPayload,
  transition: PendingTransition,
  now = Date.now(),
): PendingPayload | null {
  if (
    !isPendingPayload(payload) ||
    !Number.isFinite(now) ||
    isExpired(payload, now)
  ) {
    return null;
  }

  if (transition.type === "terminal") {
    return null;
  }

  if (transition.type === "approve") {
    if (payload.state !== "awaitingConsent") {
      return null;
    }
    return {
      id: payload.id,
      state: "queued",
      sourceUrl: payload.sourceUrl,
      selectionText: payload.selectionText,
      prompt: payload.prompt,
      createdAt: payload.createdAt,
      expiresAt: payload.expiresAt,
    };
  }

  if (transition.type === "attach-target") {
    if (
      payload.state !== "injecting" ||
      !Number.isInteger(transition.targetTabId) ||
      transition.targetTabId < 0 ||
      payload.targetTabId !== undefined
    ) {
      return null;
    }
    return {
      ...payload,
      targetTabId: transition.targetTabId,
    };
  }

  if (transition.type === "attach-consent-tab") {
    if (
      payload.state !== "awaitingConsent" ||
      !Number.isInteger(transition.consentTabId) ||
      transition.consentTabId < 0 ||
      payload.consentTabId !== undefined
    ) {
      return null;
    }
    return {
      ...payload,
      consentTabId: transition.consentTabId,
    };
  }

  if (transition.type === "mark-adapter-attempted") {
    if (
      payload.state !== "injecting" ||
      payload.adapterAttemptedAt !== undefined
    ) {
      return null;
    }
    const attemptedAt = transition.attemptedAt ?? now;
    if (!Number.isFinite(attemptedAt) || attemptedAt < payload.createdAt) {
      return null;
    }
    return {
      ...payload,
      adapterAttemptedAt: attemptedAt,
    };
  }

  if (payload.state !== "queued" || transition.claimId.trim().length === 0) {
    return null;
  }
  if (
    transition.targetTabId !== undefined &&
    (!Number.isInteger(transition.targetTabId) || transition.targetTabId < 0)
  ) {
    return null;
  }

  return {
    id: payload.id,
    state: "injecting",
    sourceUrl: payload.sourceUrl,
    selectionText: payload.selectionText,
    prompt: payload.prompt,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
    claimId: transition.claimId,
    ...(transition.targetTabId === undefined
      ? {}
      : { targetTabId: transition.targetTabId }),
  };
}

export function attachTargetTab(
  payload: PendingPayload,
  targetTabId: number,
  now = Date.now(),
): PendingPayload | null {
  return transitionPending(
    payload,
    { type: "attach-target", targetTabId },
    now,
  );
}

export function attachConsentTab(
  payload: PendingPayload,
  consentTabId: number,
  now = Date.now(),
): PendingPayload | null {
  return transitionPending(
    payload,
    { type: "attach-consent-tab", consentTabId },
    now,
  );
}

export function markAdapterAttempted(
  payload: PendingPayload,
  attemptedAt = Date.now(),
): PendingPayload | null {
  return transitionPending(
    payload,
    { type: "mark-adapter-attempted", attemptedAt },
    attemptedAt,
  );
}

export function createPendingPayload(input: {
  readonly id: string;
  readonly state?: PendingState;
  readonly sourceUrl: string;
  readonly selectionText: string;
  readonly prompt: string;
  readonly createdAt?: number;
  readonly expiresAt?: number;
}): PendingPayload {
  const createdAt = input.createdAt ?? Date.now();
  const expiresAt = input.expiresAt ?? createdAt + PENDING_TTL_MS;
  const payload: PendingPayload = {
    id: input.id,
    state: input.state ?? "awaitingConsent",
    sourceUrl: input.sourceUrl,
    selectionText: input.selectionText,
    prompt: input.prompt,
    createdAt,
    expiresAt,
  };
  if (!isPendingPayload(payload)) {
    throw new TypeError("Invalid pending payload");
  }
  return payload;
}
