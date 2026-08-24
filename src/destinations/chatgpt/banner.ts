export type ChatGptBannerKind =
  | "dom-failure"
  | "send-unknown"
  | "clipboard-copied"
  | "clipboard-failed";

export interface ChatGptBannerInput {
  readonly kind: ChatGptBannerKind;
}

export interface ChatGptBannerCopy {
  readonly title: string;
  readonly message: string;
}

export interface ChatGptBannerResult {
  readonly shown: boolean;
  readonly reason: "created" | "updated" | "unavailable";
}

export function getChatGptBannerCopy(
  kind: ChatGptBannerKind,
): ChatGptBannerCopy {
  switch (kind) {
    case "clipboard-copied":
      return {
        title: "ContextFling",
        message:
          "ChatGPT への自動入力に失敗しました。プロンプトをクリップボードへコピーしました。ChatGPT に貼り付けてください。",
      };
    case "send-unknown":
      return {
        title: "ContextFling",
        message:
          "ChatGPT の送信結果を確認できませんでした。画面を確認し、未送信の場合だけクリップボードの内容を貼り付けてください。自動再送は行っていません。",
      };
    case "clipboard-failed":
      return {
        title: "ContextFling",
        message:
          "ChatGPT への自動入力とクリップボードへのコピーに失敗しました。再送信は行っていません。",
      };
    case "dom-failure":
      return {
        title: "ContextFling",
        message:
          "ChatGPT Web の入力欄を確認できませんでした。再送信は行っていません。",
      };
  }
}

/**
 * Show a small extension-owned banner in the current ChatGPT tab.
 *
 * This function is self-contained so it can be passed to
 * `chrome.scripting.executeScript`. It deliberately never receives the
 * selection or prompt; only a fixed status kind crosses the UI boundary.
 */
export function showChatGptBanner(
  input: ChatGptBannerInput,
): ChatGptBannerResult {
  const copy = (() => {
    switch (input?.kind) {
      case "clipboard-copied":
        return {
          title: "ContextFling",
          message:
            "ChatGPT への自動入力に失敗しました。プロンプトをクリップボードへコピーしました。ChatGPT に貼り付けてください。",
        };
      case "send-unknown":
        return {
          title: "ContextFling",
          message:
            "ChatGPT の送信結果を確認できませんでした。画面を確認し、未送信の場合だけクリップボードの内容を貼り付けてください。自動再送は行っていません。",
        };
      case "clipboard-failed":
        return {
          title: "ContextFling",
          message:
            "ChatGPT への自動入力とクリップボードへのコピーに失敗しました。再送信は行っていません。",
        };
      case "dom-failure":
        return {
          title: "ContextFling",
          message:
            "ChatGPT Web の入力欄を確認できませんでした。再送信は行っていません。",
        };
      default:
        return null;
    }
  })();

  if (!copy) {
    return { shown: false, reason: "unavailable" };
  }

  try {
    const existing = document.querySelector<HTMLElement>(
      '[data-contextfling-banner="v1"]',
    );
    const host = existing ?? document.createElement("div");
    const wasExisting = existing !== null;
    if (!wasExisting) {
      host.setAttribute("data-contextfling-banner", "v1");
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      host.style.position = "fixed";
      host.style.zIndex = "2147483647";
      host.style.insetBlockStart = "16px";
      host.style.insetInlineEnd = "16px";
      host.style.maxInlineSize = "min(420px, calc(100vw - 32px))";
      host.style.fontFamily =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      (document.body ?? document.documentElement).append(host);
    }

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    while (shadow.firstChild) {
      shadow.firstChild.remove();
    }

    const style = document.createElement("style");
    style.textContent =
      ":host{all:initial} .panel{box-sizing:border-box;display:flex;gap:12px;align-items:flex-start;padding:12px 14px;color:#fff;background:#202123;border:1px solid #565869;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.24);font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif} .copy{min-inline-size:0;flex:1} .title{font-weight:600;margin-block-end:3px} .message{overflow-wrap:anywhere} button{flex:none;border:0;padding:2px 5px;color:#c5c5d2;background:transparent;font:inherit;font-size:18px;line-height:1;cursor:pointer} button:focus-visible{outline:2px solid #8ab4f8;outline-offset:2px}";

    const panel = document.createElement("div");
    panel.className = "panel";
    const copyContainer = document.createElement("div");
    copyContainer.className = "copy";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = copy.title;
    const message = document.createElement("div");
    message.className = "message";
    message.textContent = copy.message;
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "閉じる");
    close.textContent = "×";
    close.addEventListener("click", () => host.remove(), { once: true });
    copyContainer.append(title, message);
    panel.append(copyContainer, close);
    shadow.append(style, panel);
    return {
      shown: true,
      reason: wasExisting ? "updated" : "created",
    };
  } catch {
    return { shown: false, reason: "unavailable" };
  }
}
