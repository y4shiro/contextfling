import {
  CHATGPT_SELECTOR_REGISTRY,
  type ChatGptSelectorRegistry,
} from "./selectors.js";

export type ChatGptAdapterStatus =
  | "sent"
  | "invalid-input"
  | "not-logged-in"
  | "selector-mismatch"
  | "timeout"
  | "send-unknown";

export type ChatGptAdapterPhase = "validate" | "composer" | "send";

export type ChatGptAdapterVisibilityState =
  | "visible"
  | "hidden"
  | "prerender"
  | "unloaded"
  | "unknown";

export type ChatGptAdapterFailureReason =
  | "none"
  | "invalid-input"
  | "document-not-visible"
  | "login-marker-visible"
  | "composer-timeout"
  | "composer-not-found"
  | "composer-ambiguous"
  | "composer-detached"
  | "composer-write-unconfirmed"
  | "container-not-found"
  | "send-not-found"
  | "send-ambiguous"
  | "send-disabled"
  | "send-detached"
  | "send-control-invalid"
  | "send-click-failed"
  | "send-result-unknown"
  | "post-submit-composer-detached";

export type ChatGptAttachmentState = "attached" | "detached" | "unknown";

export interface ChatGptAdapterDiagnostics {
  readonly visibilityState: ChatGptAdapterVisibilityState;
  readonly failureReason: ChatGptAdapterFailureReason;
  readonly composerCandidateCount: number;
  readonly sendCandidateCount: number;
  readonly attachment: {
    readonly composer: ChatGptAttachmentState;
    readonly container: ChatGptAttachmentState;
    readonly send: ChatGptAttachmentState;
  };
}

export interface ChatGptAdapterInput {
  readonly prompt: string;
  readonly selectors: ChatGptSelectorRegistry;
  readonly timeoutMs?: number;
  readonly postSubmitTimeoutMs?: number;
}

export interface ChatGptAdapterResult {
  readonly status: ChatGptAdapterStatus;
  readonly phase: ChatGptAdapterPhase;
  readonly attempted: boolean;
  readonly detail: string;
  readonly diagnostics: ChatGptAdapterDiagnostics;
}

/**
 * Build serializable arguments for `chrome.scripting.executeScript`.
 *
 * `runChatGptAdapter` is deliberately passed a complete selector registry.
 * The function is self-contained at execution time and does not depend on a
 * module closure, extension state, cookies, or page JavaScript variables.
 */
export function createChatGptAdapterInput(
  prompt: string,
  options: {
    readonly timeoutMs?: number;
    readonly postSubmitTimeoutMs?: number;
  } = {},
): ChatGptAdapterInput {
  return {
    prompt,
    selectors: {
      composer: [...CHATGPT_SELECTOR_REGISTRY.composer],
      sendButton: [...CHATGPT_SELECTOR_REGISTRY.sendButton],
      loginMarker: [...CHATGPT_SELECTOR_REGISTRY.loginMarker],
    },
    ...options,
  };
}

/**
 * Experimental isolated-world ChatGPT Web adapter.
 *
 * This function must remain self-contained because Chrome serializes the
 * function passed to `scripting.executeScript`. Keep module constants and
 * helper imports out of its body. The integration layer is responsible for
 * injecting it only into an explicitly granted `chatgpt.com` tab.
 */
export async function runChatGptAdapter(
  input: ChatGptAdapterInput,
): Promise<ChatGptAdapterResult> {
  const visibilityState = (): ChatGptAdapterVisibilityState => {
    if (typeof document === "undefined") {
      return "unknown";
    }
    const value = document.visibilityState;
    return value === "visible" ||
      value === "hidden" ||
      value === "prerender" ||
      value === "unloaded"
      ? value
      : "unknown";
  };

  const diagnosticsState: {
    visibilityState: ChatGptAdapterVisibilityState;
    composerCandidateCount: number;
    sendCandidateCount: number;
    attachment: {
      composer: ChatGptAttachmentState;
      container: ChatGptAttachmentState;
      send: ChatGptAttachmentState;
    };
  } = {
    visibilityState: visibilityState(),
    composerCandidateCount: 0,
    sendCandidateCount: 0,
    attachment: {
      composer: "unknown",
      container: "unknown",
      send: "unknown",
    },
  };

  const snapshotDiagnostics = (
    failureReason: ChatGptAdapterFailureReason,
  ): ChatGptAdapterDiagnostics => ({
    visibilityState: diagnosticsState.visibilityState,
    failureReason,
    composerCandidateCount: diagnosticsState.composerCandidateCount,
    sendCandidateCount: diagnosticsState.sendCandidateCount,
    attachment: {
      composer: diagnosticsState.attachment.composer,
      container: diagnosticsState.attachment.container,
      send: diagnosticsState.attachment.send,
    },
  });

  const result = (
    status: ChatGptAdapterStatus,
    phase: ChatGptAdapterPhase,
    attempted: boolean,
    detail: string,
    failureReason: ChatGptAdapterFailureReason,
  ): ChatGptAdapterResult => ({
    status,
    phase,
    attempted,
    detail,
    diagnostics: snapshotDiagnostics(failureReason),
  });

  const checkDocumentVisibility = (
    phase: ChatGptAdapterPhase,
  ): ChatGptAdapterResult | null => {
    const current = visibilityState();
    diagnosticsState.visibilityState = current;
    if (current === "visible") {
      return null;
    }
    return result(
      "selector-mismatch",
      phase,
      false,
      "ChatGPT Web タブが前面にないため、送信せず終了しました。",
      "document-not-visible",
    );
  };

  const invalid = (
    phase: ChatGptAdapterPhase,
    detail: string,
    attempted = false,
  ): ChatGptAdapterResult =>
    result("invalid-input", phase, attempted, detail, "invalid-input");

  if (
    typeof input?.prompt !== "string" ||
    input.prompt.trim().length === 0 ||
    !input.selectors ||
    !Array.isArray(input.selectors.composer) ||
    !Array.isArray(input.selectors.sendButton) ||
    !Array.isArray(input.selectors.loginMarker)
  ) {
    return invalid("validate", "prompt または selector registry が不正です。");
  }

  // A tab can be switched away from after it was created with `active: true`.
  // ChatGPT's controlled input and event handlers are not safely observable
  // while the document is hidden, so fail closed before reading or writing
  // any page DOM. This is a gate, not a retry or a deferred attempt.
  const initialVisibilityFailure = checkDocumentVisibility("composer");
  if (initialVisibilityFailure) {
    return initialVisibilityFailure;
  }

  const timeoutMs = Math.max(
    500,
    Math.min(30_000, Math.floor(input.timeoutMs ?? 12_000)),
  );
  const postSubmitTimeoutMs = Math.max(
    250,
    Math.min(5_000, Math.floor(input.postSubmitTimeoutMs ?? 1_500)),
  );

  const isVisible = (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = globalThis.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const isDisabled = (element: Element): boolean => {
    if (element instanceof HTMLButtonElement && element.disabled) {
      return true;
    }
    return element.getAttribute("aria-disabled") === "true";
  };

  const collectVisible = (
    root: ParentNode,
    selectors: readonly string[],
    enabledOnly: boolean,
  ): Element[] => {
    const candidates = new Set<Element>();
    for (const selector of selectors) {
      let matches: NodeListOf<Element>;
      try {
        matches = root.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const candidate of matches) {
        if (isVisible(candidate) && (!enabledOnly || !isDisabled(candidate))) {
          candidates.add(candidate);
        }
      }
    }
    return [...candidates];
  };

  const findVisible = (
    selectors: readonly string[],
    enabledOnly: boolean,
  ): Element | null => {
    return collectVisible(document, selectors, enabledOnly)[0] ?? null;
  };

  const findUniqueVisible = (
    root: Element,
    selectors: readonly string[],
    enabledOnly: boolean,
  ): Element | null => {
    const candidates = new Set(collectVisible(root, selectors, enabledOnly));
    if (candidates.size !== 1) {
      return null;
    }
    return candidates.values().next().value ?? null;
  };

  const hasVisibleLoginMarker = (): boolean => {
    for (const selector of input.selectors.loginMarker) {
      let candidates: NodeListOf<Element>;
      try {
        candidates = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const candidate of candidates) {
        if (isVisible(candidate)) {
          return true;
        }
      }
    }
    return false;
  };

  const waitForElement = async (
    selectors: readonly string[],
    deadlineMs: number,
    enabledOnly: boolean,
  ): Promise<Element | null> => {
    const immediate = findVisible(selectors, enabledOnly);
    if (immediate) {
      return immediate;
    }

    const root = document.documentElement ?? document.body;
    if (!root) {
      return null;
    }

    return new Promise<Element | null>((resolve) => {
      let settled = false;
      const observer = new MutationObserver(() => {
        const found = findVisible(selectors, enabledOnly);
        if (found) {
          settled = true;
          observer.disconnect();
          globalThis.clearTimeout(timer);
          resolve(found);
        }
      });
      const timer = globalThis.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        observer.disconnect();
        resolve(null);
      }, deadlineMs);
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
  };

  const waitForUniqueVisible = async (
    root: Element,
    selectors: readonly string[],
    deadlineMs: number,
    enabledOnly: boolean,
  ): Promise<Element | null> => {
    const immediate = findUniqueVisible(root, selectors, enabledOnly);
    if (immediate) {
      return immediate;
    }

    return new Promise<Element | null>((resolve) => {
      let settled = false;
      const observer = new MutationObserver(() => {
        const found = findUniqueVisible(root, selectors, enabledOnly);
        if (found) {
          settled = true;
          observer.disconnect();
          globalThis.clearTimeout(timer);
          resolve(found);
        }
      });
      const timer = globalThis.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        observer.disconnect();
        resolve(null);
      }, deadlineMs);
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
  };

  const getContentEditableText = (element: HTMLElement): string | null => {
    const childNodes = Array.from(element.childNodes);
    if (childNodes.length === 0) {
      return "";
    }
    if (childNodes.every((child) => child.nodeType === 3)) {
      return childNodes.map((child) => child.nodeValue ?? "").join("");
    }

    for (const child of childNodes) {
      if (child.nodeType === 3 && (child.nodeValue ?? "").trim() === "") {
        continue;
      }
      if (child.nodeType !== 1 || (child as Element).tagName !== "P") {
        return null;
      }
    }

    const paragraphs = Array.from(element.children);
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      if (paragraph.tagName !== "P") {
        return null;
      }

      const children = Array.from(paragraph.childNodes);
      const isEmptyParagraph = paragraph.hasAttribute("data-empty-paragraph");
      if (isEmptyParagraph) {
        if (
          children.length === 0 ||
          (children.length === 1 &&
            children[0]?.nodeType === 1 &&
            (children[0] as Element).tagName === "BR")
        ) {
          lines.push("");
          continue;
        }
        return null;
      }

      if (children.length === 0) {
        return null;
      }
      let line = "";
      for (const child of children) {
        if (child.nodeType !== 3) {
          return null;
        }
        line += child.nodeValue ?? "";
      }
      lines.push(line);
    }
    return lines.join("\n");
  };

  const getComposerText = (element: Element): string | null => {
    if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement
    ) {
      return element.value;
    }
    if (
      element instanceof HTMLElement &&
      element.getAttribute("contenteditable") === "true"
    ) {
      return getContentEditableText(element);
    }
    return null;
  };

  const fillComposer = (element: Element, prompt: string): boolean => {
    try {
      element.scrollIntoView({ block: "center", inline: "nearest" });
      element.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
      if (
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLInputElement
      ) {
        const prototype = Object.getPrototypeOf(element) as object;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor?.set) {
          descriptor.set.call(element, prompt);
        } else {
          element.value = prompt;
        }
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: prompt,
          }),
        );
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (
        element instanceof HTMLElement &&
        element.getAttribute("contenteditable") === "true"
      ) {
        element.textContent = prompt;
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: prompt,
          }),
        );
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        return false;
      }
      return getComposerText(element) === prompt;
    } catch {
      return false;
    }
  };

  const waitForComposerToClear = async (
    composer: Element,
    deadlineMs: number,
  ): Promise<boolean> => {
    if (document.contains(composer)) {
      const text = getComposerText(composer);
      if (text !== null && text.trim().length === 0) {
        return true;
      }
    }
    const root = document.documentElement ?? document.body;
    if (!root) {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (cleared: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        observer.disconnect();
        globalThis.clearTimeout(timer);
        resolve(cleared);
      };
      const observer = new MutationObserver(() => {
        if (!document.contains(composer)) {
          // A framework re-render can detach the composer without sending.
          // Treat that state as unknown so the coordinator uses its
          // one-shot fallback instead of declaring a successful send.
          finish(false);
          return;
        }
        const text = getComposerText(composer);
        if (text !== null && text.trim().length === 0) {
          finish(true);
        }
      });
      const timer = globalThis.setTimeout(() => {
        // Background tabs can delay observer delivery. Read the final DOM
        // state once more at the deadline, but never treat a detached
        // composer as a successful send.
        let cleared = false;
        if (document.contains(composer)) {
          const text = getComposerText(composer);
          cleared = text !== null && text.trim().length === 0;
        }
        finish(cleared);
      }, deadlineMs);
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
  };

  const detectedComposer = await waitForElement(
    input.selectors.composer,
    timeoutMs,
    false,
  );
  const initialComposerCandidates = collectVisible(
    document,
    input.selectors.composer,
    false,
  );
  diagnosticsState.composerCandidateCount = initialComposerCandidates.length;
  if (initialComposerCandidates.length > 1) {
    return result(
      "selector-mismatch",
      "composer",
      false,
      "入力欄候補を一意に確認できませんでした。",
      "composer-ambiguous",
    );
  }

  if (!detectedComposer || initialComposerCandidates.length === 0) {
    if (hasVisibleLoginMarker()) {
      return result(
        "not-logged-in",
        "composer",
        false,
        "ログイン後に利用できる入力欄を確認できませんでした。",
        "login-marker-visible",
      );
    }
    return result(
      "timeout",
      "composer",
      false,
      "入力欄の検出がタイムアウトしました。",
      "composer-timeout",
    );
  }

  let composer = initialComposerCandidates[0] as Element;

  diagnosticsState.attachment.composer = document.contains(composer)
    ? "attached"
    : "detached";
  if (!document.contains(composer)) {
    return result(
      "selector-mismatch",
      "composer",
      false,
      "入力欄が DOM から切り離されました。",
      "composer-detached",
    );
  }

  const prefillVisibilityFailure = checkDocumentVisibility("composer");
  if (prefillVisibilityFailure) {
    return prefillVisibilityFailure;
  }

  if (!fillComposer(composer, input.prompt)) {
    return result(
      "selector-mismatch",
      "composer",
      false,
      "入力欄への標準 DOM event による入力に失敗しました。",
      "composer-write-unconfirmed",
    );
  }

  // Resolve the send control only within the composer’s own form or its
  // immediate container. A global match can click another visible composer;
  // no related container means that we cannot safely identify the target.
  const sendContainer = composer.closest("form") ?? composer.parentElement;
  if (!sendContainer) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "入力欄に関連する送信コンテナを確認できませんでした。",
      "container-not-found",
    );
  }
  diagnosticsState.attachment.container = document.contains(sendContainer)
    ? "attached"
    : "detached";
  if (!document.contains(sendContainer)) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信コンテナが DOM から切り離されました。",
      "send-detached",
    );
  }
  const sendButton = await waitForUniqueVisible(
    sendContainer,
    input.selectors.sendButton,
    timeoutMs,
    true,
  );
  const initialSendCandidates = collectVisible(
    sendContainer,
    input.selectors.sendButton,
    false,
  );
  diagnosticsState.sendCandidateCount = initialSendCandidates.length;
  if (!sendButton) {
    const failureReason: ChatGptAdapterFailureReason =
      initialSendCandidates.length > 1
        ? "send-ambiguous"
        : initialSendCandidates.length === 1 &&
            isDisabled(initialSendCandidates[0] as Element)
          ? "send-disabled"
          : "send-not-found";
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信ボタンを一意に確認できませんでした。",
      failureReason,
    );
  }

  // Let same-turn framework work (for example a controlled-input update or a
  // hydration replacement queued by the page) settle before the final,
  // synchronous control lookup. This is not a retry and does not dispatch a
  // second input or send operation.
  await Promise.resolve();

  // The page can replace the React composer/form after input events. Resolve
  // all three controls again immediately before click so a stale detached
  // node can never receive the one allowed send operation.
  const currentComposerCandidates = collectVisible(
    document,
    input.selectors.composer,
    false,
  );
  diagnosticsState.composerCandidateCount = currentComposerCandidates.length;
  if (currentComposerCandidates.length === 0) {
    diagnosticsState.attachment.composer = document.contains(composer)
      ? "attached"
      : "detached";
    return result(
      "selector-mismatch",
      "composer",
      false,
      "送信直前に入力欄を再確認できませんでした。",
      "composer-not-found",
    );
  }
  if (currentComposerCandidates.length > 1) {
    return result(
      "selector-mismatch",
      "composer",
      false,
      "送信直前に入力欄を一意に確認できませんでした。",
      "composer-ambiguous",
    );
  }
  const currentComposer = currentComposerCandidates[0] as Element;
  if (currentComposer !== composer && !document.contains(composer)) {
    diagnosticsState.attachment.composer = "detached";
  }
  composer = currentComposer;
  diagnosticsState.attachment.composer = document.contains(composer)
    ? "attached"
    : "detached";
  if (!document.contains(composer)) {
    return result(
      "selector-mismatch",
      "composer",
      false,
      "送信直前に入力欄が DOM から切り離されました。",
      "composer-detached",
    );
  }
  if (getComposerText(composer) !== input.prompt) {
    return result(
      "selector-mismatch",
      "composer",
      false,
      "送信直前に入力欄の状態を確認できませんでした。",
      "composer-write-unconfirmed",
    );
  }

  const currentSendContainer =
    composer.closest("form") ?? composer.parentElement;
  if (!currentSendContainer) {
    diagnosticsState.attachment.container = "unknown";
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信直前に入力欄に関連する送信コンテナを確認できませんでした。",
      "container-not-found",
    );
  }
  diagnosticsState.attachment.container = document.contains(
    currentSendContainer,
  )
    ? "attached"
    : "detached";
  if (!document.contains(currentSendContainer)) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信直前に送信コンテナが DOM から切り離されました。",
      "send-detached",
    );
  }

  const currentSendCandidates = collectVisible(
    currentSendContainer,
    input.selectors.sendButton,
    false,
  );
  diagnosticsState.sendCandidateCount = currentSendCandidates.length;
  if (currentSendCandidates.length === 0) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信直前に送信ボタンを確認できませんでした。",
      "send-not-found",
    );
  }
  if (currentSendCandidates.length > 1) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信直前に送信ボタンを一意に確認できませんでした。",
      "send-ambiguous",
    );
  }
  const currentSendButton = currentSendCandidates[0] as Element;
  diagnosticsState.attachment.send = document.contains(currentSendButton)
    ? "attached"
    : "detached";
  if (
    !document.contains(currentSendButton) ||
    !currentSendContainer.contains(currentSendButton)
  ) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信直前に送信ボタンが DOM から切り離されました。",
      "send-detached",
    );
  }
  if (isDisabled(currentSendButton)) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信直前に送信ボタンが無効化されました。",
      "send-disabled",
    );
  }
  if (!(currentSendButton instanceof HTMLElement)) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信ボタンが標準 DOM 要素ではありません。",
      "send-control-invalid",
    );
  }

  const presendVisibilityFailure = checkDocumentVisibility("send");
  if (presendVisibilityFailure) {
    return presendVisibilityFailure;
  }

  let clickDispatched = false;
  try {
    currentSendButton.click();
    clickDispatched = true;
  } catch {
    return result(
      "send-unknown",
      "send",
      true,
      "送信ボタンの操作結果を確認できませんでした。",
      "send-click-failed",
    );
  }

  if (!clickDispatched) {
    return result(
      "send-unknown",
      "send",
      true,
      "送信ボタンの操作結果を確認できませんでした。",
      "send-click-failed",
    );
  }

  const cleared = await waitForComposerToClear(composer, postSubmitTimeoutMs);
  diagnosticsState.attachment.composer = document.contains(composer)
    ? "attached"
    : "detached";
  if (!cleared) {
    const failureReason: ChatGptAdapterFailureReason = document.contains(
      composer,
    )
      ? "send-result-unknown"
      : "post-submit-composer-detached";
    return result(
      "send-unknown",
      "send",
      true,
      "送信操作後も入力欄の状態を確定できませんでした。再送信は行いません。",
      failureReason,
    );
  }
  return result(
    "sent",
    "send",
    true,
    "送信操作を一度だけ実行しました。",
    "none",
  );
}
