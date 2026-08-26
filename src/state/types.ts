export const CONSENT_VERSION = "chatgpt-web-dom-v1" as const;

export type ConsentVersion = typeof CONSENT_VERSION;
export type PendingState = "awaitingConsent" | "queued" | "injecting";

export interface PendingPayload {
  readonly id: string;
  readonly state: PendingState;
  readonly sourceUrl: string;
  readonly selectionText: string;
  readonly prompt: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** The extension settings tab displaying the one-time consent preview. */
  readonly consentTabId?: number;
  readonly claimId?: string;
  readonly targetTabId?: number;
  /** Set immediately before the single ChatGPT DOM adapter attempt. */
  readonly adapterAttemptedAt?: number;
}

export interface Settings {
  readonly consentVersion: ConsentVersion | null;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  consentVersion: null,
});

export const PENDING_TTL_MS = 10 * 60 * 1000;

export function isPendingState(value: unknown): value is PendingState {
  return (
    value === "awaitingConsent" || value === "queued" || value === "injecting"
  );
}

export function isConsentVersion(value: unknown): value is ConsentVersion {
  return value === CONSENT_VERSION;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** storage.session から取得した untrusted 値の runtime guard。 */
export function isPendingPayload(value: unknown): value is PendingPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  if (
    typeof payload.id !== "string" ||
    payload.id.length === 0 ||
    !isPendingState(payload.state) ||
    typeof payload.sourceUrl !== "string" ||
    payload.sourceUrl.length === 0 ||
    typeof payload.selectionText !== "string" ||
    payload.selectionText.length === 0 ||
    typeof payload.prompt !== "string" ||
    payload.prompt.length === 0 ||
    !isFiniteNumber(payload.createdAt) ||
    !isFiniteNumber(payload.expiresAt) ||
    payload.expiresAt <= payload.createdAt
  ) {
    return false;
  }

  if (
    payload.consentTabId !== undefined &&
    (typeof payload.consentTabId !== "number" ||
      !Number.isInteger(payload.consentTabId) ||
      payload.consentTabId < 0)
  ) {
    return false;
  }
  if (
    payload.claimId !== undefined &&
    (typeof payload.claimId !== "string" || payload.claimId.length === 0)
  ) {
    return false;
  }
  if (
    payload.targetTabId !== undefined &&
    (typeof payload.targetTabId !== "number" ||
      !Number.isInteger(payload.targetTabId) ||
      payload.targetTabId < 0)
  ) {
    return false;
  }
  if (
    payload.adapterAttemptedAt !== undefined &&
    (typeof payload.adapterAttemptedAt !== "number" ||
      !Number.isFinite(payload.adapterAttemptedAt) ||
      payload.adapterAttemptedAt < payload.createdAt)
  ) {
    return false;
  }

  if (payload.state === "injecting" && payload.claimId === undefined) {
    return false;
  }
  if (
    payload.state !== "injecting" &&
    (payload.claimId !== undefined ||
      payload.targetTabId !== undefined ||
      payload.adapterAttemptedAt !== undefined)
  ) {
    return false;
  }
  if (
    payload.state !== "awaitingConsent" &&
    payload.consentTabId !== undefined
  ) {
    return false;
  }
  return true;
}
