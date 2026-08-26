import { OPTIONAL_PERMISSION_BUNDLE } from "./permissions.js";

export const SETTINGS_MESSAGE_TYPES = {
  getSettings: "contextfling.settings.get",
  getPreview: "contextfling.settings.preview.get",
  approvePreview: "contextfling.settings.preview.approve",
  rejectPreview: "contextfling.settings.preview.reject",
  revokeConsent: "contextfling.settings.consent.revoke",
} as const;

export type SettingsMessageType =
  (typeof SETTINGS_MESSAGE_TYPES)[keyof typeof SETTINGS_MESSAGE_TYPES];

export interface PreviewData {
  readonly destination: "https://chatgpt.com/";
  readonly prompt: string;
  readonly selectionText: string;
  readonly sourceUrl: string;
}

export interface SettingsSnapshot {
  readonly consentVersion: string | null;
}

export type SettingsMessage =
  | {
      readonly type: typeof SETTINGS_MESSAGE_TYPES.getSettings;
    }
  | {
      readonly type: typeof SETTINGS_MESSAGE_TYPES.getPreview;
      readonly requestId: string;
    }
  | {
      readonly type: typeof SETTINGS_MESSAGE_TYPES.approvePreview;
      readonly requestId: string;
    }
  | {
      readonly type: typeof SETTINGS_MESSAGE_TYPES.rejectPreview;
      readonly requestId: string;
    }
  | {
      readonly type: typeof SETTINGS_MESSAGE_TYPES.revokeConsent;
    };

export interface RuntimeResponse {
  readonly consentGranted?: boolean;
  readonly message?: string;
  readonly preview?: PreviewData;
  readonly settings?: SettingsSnapshot;
  readonly ok: boolean;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function parseRequestId(search: string, hash: string): string | null {
  const searchParams = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const searchRequestId = searchParams.get("requestId");
  if (isRequestId(searchRequestId)) {
    return searchRequestId;
  }

  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const fragmentParams = new URLSearchParams(
    fragment.startsWith("?") ? fragment.slice(1) : fragment,
  );
  const fragmentRequestId = fragmentParams.get("requestId");
  return isRequestId(fragmentRequestId) ? fragmentRequestId : null;
}

export function createSettingsMessage(): SettingsMessage {
  return { type: SETTINGS_MESSAGE_TYPES.getSettings };
}

export function createPreviewRequestMessage(
  requestId: string,
): SettingsMessage {
  return {
    type: SETTINGS_MESSAGE_TYPES.getPreview,
    requestId,
  };
}

export function createApproveMessage(requestId: string): SettingsMessage {
  return {
    type: SETTINGS_MESSAGE_TYPES.approvePreview,
    requestId,
  };
}

export function createRejectMessage(requestId: string): SettingsMessage {
  return {
    type: SETTINGS_MESSAGE_TYPES.rejectPreview,
    requestId,
  };
}

export function createRevokeConsentMessage(): SettingsMessage {
  return { type: SETTINGS_MESSAGE_TYPES.revokeConsent };
}

export function isPreviewData(value: unknown): value is PreviewData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.destination === "https://chatgpt.com/" &&
    isNonEmptyString(value.prompt) &&
    isNonEmptyString(value.selectionText) &&
    isNonEmptyString(value.sourceUrl)
  );
}

export function isSettingsSnapshot(value: unknown): value is SettingsSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.consentVersion === null || isNonEmptyString(value.consentVersion)
  );
}

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (
    value.consentGranted !== undefined &&
    typeof value.consentGranted !== "boolean"
  ) {
    return false;
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    return false;
  }
  if (value.preview !== undefined && !isPreviewData(value.preview)) {
    return false;
  }
  if (value.settings !== undefined && !isSettingsSnapshot(value.settings)) {
    return false;
  }

  return true;
}

export function isSettingsMessage(value: unknown): value is SettingsMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case SETTINGS_MESSAGE_TYPES.getSettings:
    case SETTINGS_MESSAGE_TYPES.revokeConsent:
      return true;
    case SETTINGS_MESSAGE_TYPES.getPreview:
    case SETTINGS_MESSAGE_TYPES.approvePreview:
    case SETTINGS_MESSAGE_TYPES.rejectPreview:
      return isRequestId(value.requestId);
    default:
      return false;
  }
}

type PageElements = {
  readonly approveButton: HTMLButtonElement;
  readonly consentStatus: HTMLElement;
  readonly pageStatus: HTMLElement;
  readonly previewDestination: HTMLElement;
  readonly previewPrompt: HTMLElement;
  readonly previewSelection: HTMLElement;
  readonly previewSourceUrl: HTMLElement;
  readonly previewView: HTMLElement;
  readonly rejectButton: HTMLButtonElement;
  readonly revokeConsentButton: HTMLButtonElement;
  readonly settingsView: HTMLElement;
};

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`設定ページの要素が見つかりません: ${id}`);
  }
  return element as T;
}

function getPageElements(): PageElements {
  return {
    approveButton: getElement<HTMLButtonElement>("approve-preview"),
    consentStatus: getElement("consent-status"),
    pageStatus: getElement("page-status"),
    previewDestination: getElement("preview-destination"),
    previewPrompt: getElement("preview-prompt"),
    previewSelection: getElement("preview-selection"),
    previewSourceUrl: getElement("preview-source-url"),
    previewView: getElement("preview-view"),
    rejectButton: getElement<HTMLButtonElement>("reject-preview"),
    revokeConsentButton: getElement<HTMLButtonElement>("revoke-consent"),
    settingsView: getElement("settings-view"),
  };
}

function setStatus(
  elements: PageElements,
  message: string,
  isError = false,
): void {
  elements.pageStatus.textContent = message;
  elements.pageStatus.classList.toggle("is-error", isError);
}

function setConsentState(
  elements: PageElements,
  consentVersion: string | null,
): void {
  const granted = consentVersion !== null;
  elements.consentStatus.textContent = granted
    ? "同意済みです。"
    : "まだ同意していません。";
  elements.revokeConsentButton.disabled = !granted;
}

function setPreviewButtonsEnabled(
  elements: PageElements,
  enabled: boolean,
): void {
  elements.approveButton.disabled = !enabled;
  elements.rejectButton.disabled = !enabled;
}

function renderPreview(elements: PageElements, preview: PreviewData): void {
  elements.previewDestination.textContent = preview.destination;
  elements.previewSourceUrl.textContent = preview.sourceUrl;
  elements.previewSelection.textContent = preview.selectionText;
  elements.previewPrompt.textContent = preview.prompt;
}

function showSettings(elements: PageElements): void {
  elements.settingsView.hidden = false;
  elements.previewView.hidden = true;
}

function showPreview(elements: PageElements): void {
  elements.settingsView.hidden = true;
  elements.previewView.hidden = false;
}

function sendRuntimeMessage(
  elements: PageElements,
  message: SettingsMessage,
  onResponse: (response: RuntimeResponse) => void,
): void {
  try {
    const responsePromise = chrome.runtime.sendMessage(message);
    void (async () => {
      try {
        const value: unknown = await responsePromise;
        if (!isRuntimeResponse(value)) {
          setStatus(
            elements,
            "拡張機能からの応答を確認できませんでした。",
            true,
          );
          return;
        }
        onResponse(value);
      } catch {
        setStatus(elements, "拡張機能との通信に失敗しました。", true);
      }
    })();
  } catch {
    setStatus(elements, "拡張機能との通信に失敗しました。", true);
  }
}

function setupSettingsMode(elements: PageElements): void {
  showSettings(elements);
  setStatus(elements, "設定を読み込んでいます。");

  elements.revokeConsentButton.addEventListener("click", () => {
    sendRuntimeMessage(elements, createRevokeConsentMessage(), (response) => {
      if (!response.ok) {
        if (response.consentGranted === false) {
          setConsentState(elements, null);
        }
        setStatus(
          elements,
          response.message ?? "同意を撤回できませんでした。",
          true,
        );
        return;
      }
      setConsentState(elements, null);
      setStatus(elements, "同意を撤回しました。次回に確認が必要です。");
    });
  });

  sendRuntimeMessage(elements, createSettingsMessage(), (response) => {
    if (!response.ok || response.settings === undefined) {
      setStatus(
        elements,
        response.message ?? "設定を読み込めませんでした。",
        true,
      );
      return;
    }
    setConsentState(elements, response.settings.consentVersion);
    setStatus(elements, "");
  });
}

function setupPreviewMode(elements: PageElements, requestId: string): void {
  showPreview(elements);
  setPreviewButtonsEnabled(elements, false);
  setStatus(elements, "送信内容を読み込んでいます。");

  elements.approveButton.addEventListener("click", () => {
    elements.approveButton.disabled = true;
    elements.rejectButton.disabled = true;
    let permissionRequest: Promise<boolean>;
    try {
      // Keep the permission request directly in the user-gesture handler.
      // The service worker performs the authoritative `contains` check after
      // this promise settles, regardless of the result here.
      permissionRequest = chrome.permissions.request(
        OPTIONAL_PERMISSION_BUNDLE,
      );
    } catch {
      permissionRequest = Promise.resolve(false);
    }
    setStatus(elements, "同意を処理しています。送信は一度だけ試行します。");
    void permissionRequest
      .catch(() => false)
      .then(() => {
        sendRuntimeMessage(
          elements,
          createApproveMessage(requestId),
          (response) => {
            if (response.ok) {
              setStatus(elements, "送信処理を開始しました。");
              return;
            }
            setStatus(
              elements,
              response.message ?? "送信を開始できませんでした。",
              true,
            );
          },
        );
      });
  });

  elements.rejectButton.addEventListener("click", () => {
    elements.approveButton.disabled = true;
    elements.rejectButton.disabled = true;
    setStatus(elements, "送信せずに破棄しています。");
    sendRuntimeMessage(elements, createRejectMessage(requestId), (response) => {
      setStatus(
        elements,
        response.ok
          ? "送信せずに破棄しました。"
          : (response.message ?? "破棄できませんでした."),
        !response.ok,
      );
    });
  });

  sendRuntimeMessage(
    elements,
    createPreviewRequestMessage(requestId),
    (response) => {
      if (!response.ok || response.preview === undefined) {
        setStatus(
          elements,
          response.message ?? "送信内容を読み込めませんでした。",
          true,
        );
        return;
      }
      renderPreview(elements, response.preview);
      setPreviewButtonsEnabled(elements, true);
      setStatus(elements, "送信内容を確認してください。");
    },
  );
}

export function bootstrapSettingsPage(): void {
  if (typeof document === "undefined" || typeof chrome === "undefined") {
    return;
  }

  const elements = getPageElements();
  const requestId = parseRequestId(
    window.location.search,
    window.location.hash,
  );
  if (requestId === null) {
    setupSettingsMode(elements);
    return;
  }
  setupPreviewMode(elements, requestId);
}

if (typeof document !== "undefined") {
  bootstrapSettingsPage();
}
