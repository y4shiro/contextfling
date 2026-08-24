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
  const invalid = (
    phase: ChatGptAdapterPhase,
    detail: string,
    attempted = false,
  ): ChatGptAdapterResult => ({
    status: "invalid-input",
    phase,
    attempted,
    detail,
  });

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

  const timeoutMs = Math.max(
    500,
    Math.min(30_000, Math.floor(input.timeoutMs ?? 12_000)),
  );
  const postSubmitTimeoutMs = Math.max(
    250,
    Math.min(5_000, Math.floor(input.postSubmitTimeoutMs ?? 1_500)),
  );

  const result = (
    status: ChatGptAdapterStatus,
    phase: ChatGptAdapterPhase,
    attempted: boolean,
    detail: string,
  ): ChatGptAdapterResult => ({ status, phase, attempted, detail });

  const isVisible = (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
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

  const findVisible = (
    selectors: readonly string[],
    enabledOnly: boolean,
  ): Element | null => {
    for (const selector of selectors) {
      let candidates: NodeListOf<Element>;
      try {
        candidates = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const candidate of candidates) {
        if (isVisible(candidate) && (!enabledOnly || !isDisabled(candidate))) {
          return candidate;
        }
      }
    }
    return null;
  };

  const findUniqueVisible = (
    root: Element,
    selectors: readonly string[],
    enabledOnly: boolean,
  ): Element | null => {
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

  const getComposerText = (element: Element): string => {
    if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement
    ) {
      return element.value;
    }
    return element.textContent ?? "";
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
      } else if (element instanceof HTMLElement) {
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
    if (getComposerText(composer).trim().length === 0) {
      return true;
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
        if (getComposerText(composer).trim().length === 0) {
          finish(true);
        }
      });
      const timer = globalThis.setTimeout(() => finish(false), deadlineMs);
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
  };

  const composer = await waitForElement(
    input.selectors.composer,
    timeoutMs,
    false,
  );
  if (!composer) {
    if (hasVisibleLoginMarker()) {
      return result(
        "not-logged-in",
        "composer",
        false,
        "ログイン後に利用できる入力欄を確認できませんでした。",
      );
    }
    return result(
      "timeout",
      "composer",
      false,
      "入力欄の検出がタイムアウトしました。",
    );
  }

  if (!fillComposer(composer, input.prompt)) {
    return result(
      "selector-mismatch",
      "composer",
      false,
      "入力欄への標準 DOM event による入力に失敗しました。",
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
    );
  }
  const sendButton = await waitForUniqueVisible(
    sendContainer,
    input.selectors.sendButton,
    timeoutMs,
    true,
  );
  if (!sendButton) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信ボタンを一意に確認できませんでした。",
    );
  }
  if (!(sendButton instanceof HTMLElement)) {
    return result(
      "selector-mismatch",
      "send",
      false,
      "送信ボタンが標準 DOM 要素ではありません。",
    );
  }

  let clickDispatched = false;
  try {
    sendButton.click();
    clickDispatched = true;
  } catch {
    return result(
      "send-unknown",
      "send",
      true,
      "送信ボタンの操作結果を確認できませんでした。",
    );
  }

  if (!clickDispatched) {
    return result(
      "send-unknown",
      "send",
      true,
      "送信ボタンの操作結果を確認できませんでした。",
    );
  }

  const cleared = await waitForComposerToClear(composer, postSubmitTimeoutMs);
  if (!cleared) {
    return result(
      "send-unknown",
      "send",
      true,
      "送信操作後も入力欄の状態を確定できませんでした。再送信は行いません。",
    );
  }
  return result("sent", "send", true, "送信操作を一度だけ実行しました。");
}
