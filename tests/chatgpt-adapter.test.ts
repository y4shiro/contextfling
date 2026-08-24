import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { JSDOM as JSDOMType } from "jsdom";

import {
  createChatGptAdapterInput,
  runChatGptAdapter,
} from "../src/destinations/chatgpt/adapter.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as typeof import("jsdom");

type VisibilityState = "visible" | "hidden" | "prerender" | "unloaded";

interface InstalledDom {
  readonly dom: JSDOMType;
  readonly cleanup: () => void;
}

function installDom(
  markup: string,
  visibilityState: VisibilityState = "visible",
): InstalledDom {
  const dom = new JSDOM(markup, { url: "https://chatgpt.com/" });
  Object.defineProperty(dom.window.document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });

  const elementPrototype = dom.window.HTMLElement.prototype;
  const originalRect = elementPrototype.getBoundingClientRect;
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    elementPrototype,
    "scrollIntoView",
  );
  Object.defineProperty(elementPrototype, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        bottom: 20,
        height: 20,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });
  Object.defineProperty(elementPrototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });

  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    MutationObserver: dom.window.MutationObserver,
    InputEvent: dom.window.InputEvent,
    FocusEvent: dom.window.FocusEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  };
  const globalObject = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<
    string,
    { readonly exists: boolean; readonly value: unknown }
  >();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, {
      exists: Object.hasOwn(globalObject, key),
      value: globalObject[key],
    });
    Object.defineProperty(globalObject, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  return {
    dom,
    cleanup: () => {
      if (originalScrollIntoView) {
        Object.defineProperty(
          elementPrototype,
          "scrollIntoView",
          originalScrollIntoView,
        );
      } else {
        delete (elementPrototype as unknown as Record<string, unknown>)
          .scrollIntoView;
      }
      Object.defineProperty(elementPrototype, "getBoundingClientRect", {
        configurable: true,
        value: originalRect,
      });
      for (const [key, state] of previous) {
        if (state.exists) {
          Object.defineProperty(globalObject, key, {
            configurable: true,
            value: state.value,
            writable: true,
          });
        } else {
          delete globalObject[key];
        }
      }
      dom.window.close();
    },
  };
}

async function readChatGptFixture(name: string): Promise<string> {
  return readFile(resolve(projectRoot, "tests/fixtures/chatgpt", name), "utf8");
}

function adapterInput(
  prompt = "fixture prompt",
  options: {
    readonly timeoutMs?: number;
    readonly postSubmitTimeoutMs?: number;
  } = {},
) {
  return createChatGptAdapterInput(prompt, {
    timeoutMs: 500,
    postSubmitTimeoutMs: 250,
    ...options,
  });
}

test("ChatGPT adapter は executeScript の自己完結関数と serializable input を公開する", async () => {
  const [adapterSource, selectorSource] = await Promise.all([
    readFile(
      resolve(projectRoot, "src/destinations/chatgpt/adapter.ts"),
      "utf8",
    ),
    readFile(
      resolve(projectRoot, "src/destinations/chatgpt/selectors.ts"),
      "utf8",
    ),
  ]);

  assert.match(adapterSource, /export async function runChatGptAdapter/);
  assert.match(adapterSource, /createChatGptAdapterInput/);
  assert.match(adapterSource, /selectors:\s*ChatGptSelectorRegistry/);
  assert.match(selectorSource, /CHATGPT_SELECTOR_REGISTRY/);
  assert.match(adapterSource, /timeoutMs\?/);
  assert.match(adapterSource, /postSubmitTimeoutMs\?/);
});

test("ChatGPT selector registry は入力・送信・ログイン候補を専用境界に置く", async () => {
  const selectorSource = await readFile(
    resolve(projectRoot, "src/destinations/chatgpt/selectors.ts"),
    "utf8",
  );

  assert.ok(selectorSource.includes('textarea[data-testid="textbox"]'));
  assert.ok(selectorSource.includes('data-testid="send-button"'));
  assert.ok(selectorSource.includes("loginMarker"));
  assert.match(selectorSource, /Object\.freeze/);
});

test("DOM adapter と banner の実装は危険なページ境界を利用しない", async () => {
  const adapterSource = await readFile(
    resolve(projectRoot, "src/destinations/chatgpt/adapter.ts"),
    "utf8",
  );
  const bannerSource = await readFile(
    resolve(projectRoot, "src/destinations/chatgpt/banner.ts"),
    "utf8",
  );

  assert.match(adapterSource, /MutationObserver/);
  assert.match(adapterSource, /setTimeout/);
  assert.match(adapterSource, /\.click\(\)/);
  assert.doesNotMatch(adapterSource, /innerHTML/);
  assert.doesNotMatch(adapterSource, /document\.cookie/);
  assert.doesNotMatch(adapterSource, /(?:localStorage|sessionStorage)/);
  assert.doesNotMatch(adapterSource, /\bfetch\s*\(/);
  assert.match(
    adapterSource,
    /document\.contains\(composer\)[\s\S]*?finish\(false\)/,
  );
  assert.match(
    adapterSource,
    /composer\.closest\("form"\) \?\? composer\.parentElement/,
  );
  assert.match(adapterSource, /new Set<Element>\(\)/);
  assert.match(adapterSource, /waitForUniqueVisible\(/);
  assert.doesNotMatch(
    adapterSource,
    /const sendButton = await waitForElement\(/,
  );
  assert.doesNotMatch(bannerSource, /innerHTML/);
  assert.match(bannerSource, /attachShadow/);
  assert.doesNotMatch(bannerSource, /textContent\s*=\s*input/);
});

test("banner は selection 本文を含めず固定の失敗状態だけを表示する", async () => {
  const bannerSource = await readFile(
    resolve(projectRoot, "src/destinations/chatgpt/banner.ts"),
    "utf8",
  );
  assert.match(bannerSource, /clipboard-copied/);
  assert.match(bannerSource, /clipboard-failed/);
  assert.match(bannerSource, /dom-failure/);
  assert.match(bannerSource, /ChatGPT/);
  assert.doesNotMatch(bannerSource, /selectionText/);
  const bannerInput =
    bannerSource.match(/export interface ChatGptBannerInput[\s\S]*?\n}/)?.[0] ??
    "";
  assert.doesNotMatch(bannerInput, /prompt/);
});

test("ChatGPT fixture はログイン済み、未ログイン、DOM変更の3状態を分離する", async () => {
  const fixtureDir = resolve(projectRoot, "tests/fixtures/chatgpt");
  const [composer, login, changed] = await Promise.all([
    readFile(resolve(fixtureDir, "composer.html"), "utf8"),
    readFile(resolve(fixtureDir, "login.html"), "utf8"),
    readFile(resolve(fixtureDir, "dom-changed.html"), "utf8"),
  ]);

  assert.match(composer, /data-testid="textbox"/);
  assert.match(composer, /data-testid="send-button"/);
  assert.match(login, /auth\/login/);
  assert.doesNotMatch(login, /data-testid="textbox"/);
  assert.match(changed, /unsupported-composer/);
  assert.doesNotMatch(changed, /data-testid="textbox"/);
});

test("初期から visible composer が複数なら書き込み・送信せず ambiguous で終端する", async () => {
  const installed = installDom(`
    <!doctype html>
    <html>
      <body>
        <form>
          <textarea data-testid="textbox"></textarea>
          <button data-testid="send-button" type="button">Send 1</button>
        </form>
        <form>
          <textarea data-testid="textbox"></textarea>
          <button data-testid="send-button" type="button">Send 2</button>
        </form>
      </body>
    </html>
  `);
  try {
    const composers = Array.from(
      installed.dom.window.document.querySelectorAll<HTMLTextAreaElement>(
        'textarea[data-testid="textbox"]',
      ),
    );
    const buttons = Array.from(
      installed.dom.window.document.querySelectorAll<HTMLButtonElement>(
        'button[data-testid="send-button"]',
      ),
    );
    assert.equal(composers.length, 2);
    assert.equal(buttons.length, 2);
    let clickCount = 0;
    for (const button of buttons) {
      button.addEventListener("click", () => {
        clickCount += 1;
      });
    }

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "composer");
    assert.equal(result.diagnostics.failureReason, "composer-ambiguous");
    assert.equal(result.attempted, false);
    assert.equal(result.diagnostics.composerCandidateCount, 2);
    assert.equal(clickCount, 0);
    for (const composer of composers) {
      assert.equal(composer.value, "");
    }
  } finally {
    installed.cleanup();
  }
});

test("adapter は foreground で一度だけ送信し、非機密 diagnostics を返す", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup);
  try {
    const textarea = installed.dom.window.document.querySelector(
      'textarea[data-testid="textbox"]',
    );
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(textarea instanceof installed.dom.window.HTMLTextAreaElement);
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);

    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
      textarea.value = "";
      textarea.dispatchEvent(
        new installed.dom.window.Event("input", { bubbles: true }),
      );
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "sent");
    assert.equal(result.attempted, true);
    assert.equal(clickCount, 1);
    assert.deepEqual(result.diagnostics, {
      visibilityState: "visible",
      failureReason: "none",
      composerCandidateCount: 1,
      sendCandidateCount: 1,
      attachment: {
        composer: "attached",
        container: "attached",
        send: "attached",
      },
    });
    assert.doesNotMatch(JSON.stringify(result), /fixture prompt/);
  } finally {
    installed.cleanup();
  }
});

test("hidden document で handler が未準備なら一度の click 後に send-unknown となる", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup, "hidden");
  try {
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);

    let clickCount = 0;
    const originalClick = button.click.bind(button);
    button.click = () => {
      clickCount += 1;
      originalClick();
    };

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "send-unknown");
    assert.equal(result.phase, "send");
    assert.equal(result.attempted, true);
    assert.equal(clickCount, 1);
    assert.equal(result.diagnostics.visibilityState, "hidden");
    assert.equal(result.diagnostics.failureReason, "send-result-unknown");
    assert.equal(result.diagnostics.attachment.send, "attached");
  } finally {
    installed.cleanup();
  }
});

test("delayed hydration 後に composer と send control が揃えば送信する", async () => {
  const installed = installDom(
    "<!doctype html><html><body><main id=app></main></body></html>",
  );
  try {
    const promise = runChatGptAdapter(adapterInput("hydrated prompt"));
    setTimeout(() => {
      const form = installed.dom.window.document.createElement("form");
      const textarea = installed.dom.window.document.createElement("textarea");
      textarea.dataset.testid = "textbox";
      const button = installed.dom.window.document.createElement("button");
      button.dataset.testid = "send-button";
      button.type = "button";
      button.addEventListener("click", () => {
        textarea.value = "";
      });
      form.append(textarea, button);
      installed.dom.window.document.querySelector("#app")?.append(form);
    }, 10);

    const result = await promise;

    assert.equal(result.status, "sent");
    assert.equal(result.diagnostics.composerCandidateCount, 1);
    assert.equal(result.diagnostics.sendCandidateCount, 1);
  } finally {
    installed.cleanup();
  }
});

test("controlled input が DOM 書き込みを反映しない場合は click しない", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup);
  try {
    const textarea = installed.dom.window.document.querySelector(
      'textarea[data-testid="textbox"]',
    );
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(textarea instanceof installed.dom.window.HTMLTextAreaElement);
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);
    textarea.addEventListener("input", () => {
      textarea.value = "";
    });
    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "composer");
    assert.equal(result.attempted, false);
    assert.equal(
      result.diagnostics.failureReason,
      "composer-write-unconfirmed",
    );
    assert.equal(clickCount, 0);
  } finally {
    installed.cleanup();
  }
});

test("同一 turn の DOM replacement は最新 composer を再取得し、古い send control を click しない", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup);
  try {
    const oldForm = installed.dom.window.document.querySelector("form");
    const oldTextarea = installed.dom.window.document.querySelector(
      'textarea[data-testid="textbox"]',
    );
    const oldButton = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(oldForm instanceof installed.dom.window.HTMLFormElement);
    assert.ok(oldTextarea instanceof installed.dom.window.HTMLTextAreaElement);
    assert.ok(oldButton instanceof installed.dom.window.HTMLButtonElement);

    let oldClickCount = 0;
    let newClickCount = 0;
    oldButton.addEventListener("click", () => {
      oldClickCount += 1;
    });
    oldTextarea.addEventListener("input", () => {
      queueMicrotask(() => {
        const newForm = installed.dom.window.document.createElement("form");
        const newTextarea =
          installed.dom.window.document.createElement("textarea");
        newTextarea.dataset.testid = "textbox";
        newTextarea.value = "fixture prompt";
        const newButton = installed.dom.window.document.createElement("button");
        newButton.dataset.testid = "send-button";
        newButton.type = "button";
        newButton.addEventListener("click", () => {
          newClickCount += 1;
          newTextarea.value = "";
        });
        newForm.append(newTextarea, newButton);
        oldForm.replaceWith(newForm);
      });
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "sent");
    assert.equal(result.attempted, true);
    assert.equal(oldClickCount, 0);
    assert.equal(newClickCount, 1);
    assert.equal(result.diagnostics.attachment.composer, "attached");
  } finally {
    installed.cleanup();
  }
});

test("composer が detached になった場合は send せず終端する", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup);
  try {
    const form = installed.dom.window.document.querySelector("form");
    const textarea = installed.dom.window.document.querySelector(
      'textarea[data-testid="textbox"]',
    );
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(form instanceof installed.dom.window.HTMLFormElement);
    assert.ok(textarea instanceof installed.dom.window.HTMLTextAreaElement);
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);
    textarea.addEventListener("input", () => form.remove());
    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "send");
    assert.equal(result.attempted, false);
    assert.equal(result.diagnostics.failureReason, "send-detached");
    assert.equal(result.diagnostics.attachment.container, "detached");
    assert.equal(clickCount, 0);
  } finally {
    installed.cleanup();
  }
});

test("send control がない場合は候補数を記録して click しない", async () => {
  const installed = installDom(
    "<!doctype html><html><body><form><textarea data-testid=textbox></textarea></form></body></html>",
  );
  try {
    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "send");
    assert.equal(result.diagnostics.failureReason, "send-not-found");
    assert.equal(result.diagnostics.sendCandidateCount, 0);
    assert.equal(result.attempted, false);
  } finally {
    installed.cleanup();
  }
});

test("send control が disabled の場合は click しない", async () => {
  const installed = installDom(
    "<!doctype html><html><body><form><textarea data-testid=textbox></textarea><button data-testid=send-button disabled></button></form></body></html>",
  );
  try {
    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "send");
    assert.equal(result.diagnostics.failureReason, "send-disabled");
    assert.equal(result.diagnostics.sendCandidateCount, 1);
    assert.equal(result.attempted, false);
  } finally {
    installed.cleanup();
  }
});

test("send control が duplicate の場合は ambiguous として click しない", async () => {
  const installed = installDom(
    "<!doctype html><html><body><form><textarea data-testid=textbox></textarea><button data-testid=send-button></button><button data-testid=send-button></button></form></body></html>",
  );
  try {
    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "send");
    assert.equal(result.diagnostics.failureReason, "send-ambiguous");
    assert.equal(result.diagnostics.sendCandidateCount, 2);
    assert.equal(result.attempted, false);
  } finally {
    installed.cleanup();
  }
});

test("synthetic click が no-op の場合は一度だけ試行し send-unknown にする", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup);
  try {
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);
    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "send-unknown");
    assert.equal(result.diagnostics.failureReason, "send-result-unknown");
    assert.equal(result.attempted, true);
    assert.equal(clickCount, 1);
  } finally {
    installed.cleanup();
  }
});

test("click 後に composer が detached でも成功扱いせず send-unknown にする", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup);
  try {
    const form = installed.dom.window.document.querySelector("form");
    const textarea = installed.dom.window.document.querySelector(
      'textarea[data-testid="textbox"]',
    );
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(form instanceof installed.dom.window.HTMLFormElement);
    assert.ok(textarea instanceof installed.dom.window.HTMLTextAreaElement);
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);
    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
      textarea.value = "";
      form.remove();
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "send-unknown");
    assert.equal(
      result.diagnostics.failureReason,
      "post-submit-composer-detached",
    );
    assert.equal(result.diagnostics.attachment.composer, "detached");
    assert.equal(result.attempted, true);
    assert.equal(clickCount, 1);
  } finally {
    installed.cleanup();
  }
});
