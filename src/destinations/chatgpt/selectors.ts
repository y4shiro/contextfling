/**
 * Selector registry for the experimental ChatGPT Web adapter.
 *
 * Keep selectors here rather than scattering them through the handoff
 * coordinator. ChatGPT Web does not expose a supported extension DOM API, so
 * a selector change must remain a small, reviewable adapter-only change.
 */
export interface ChatGptSelectorRegistry {
  readonly composer: readonly string[];
  readonly sendButton: readonly string[];
  readonly loginMarker: readonly string[];
}

export const CHATGPT_SELECTOR_REGISTRY: ChatGptSelectorRegistry = Object.freeze(
  {
    composer: Object.freeze([
      "#prompt-textarea",
      'textarea[data-testid="textbox"]',
      'textarea[name="prompt-textarea"]',
      'textarea[data-testid="prompt-textarea"]',
      '[contenteditable="true"][data-testid="textbox"]',
    ]),
    sendButton: Object.freeze([
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
    ]),
    loginMarker: Object.freeze([
      'a[href*="/auth/login"]',
      'a[href*="/login"]',
      '[data-testid="login-button"]',
      'button[data-testid="login-button"]',
    ]),
  },
);

export const CHATGPT_ADAPTER_TIMEOUT_MS = 12_000;
export const CHATGPT_POST_SUBMIT_TIMEOUT_MS = 1_500;

export function cloneChatGptSelectorRegistry(): ChatGptSelectorRegistry {
  return {
    composer: [...CHATGPT_SELECTOR_REGISTRY.composer],
    sendButton: [...CHATGPT_SELECTOR_REGISTRY.sendButton],
    loginMarker: [...CHATGPT_SELECTOR_REGISTRY.loginMarker],
  };
}
