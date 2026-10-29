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
  readonly execCommandCalls: string[];
  readonly cleanup: () => void;
}

type ExecCommandMode = "insert" | "false" | "throw" | "unavailable";

function installDom(
  markup: string,
  visibilityState: VisibilityState = "visible",
  execCommandMode: ExecCommandMode = "insert",
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
  for (const composer of dom.window.document.querySelectorAll<HTMLElement>(
    '[contenteditable="true"]',
  )) {
    if (!composer.hasAttribute("tabindex")) {
      // Chromium makes contenteditables focusable; JSDOM needs this fixture hint.
      composer.tabIndex = 0;
    }
  }
  const execCommandCalls: string[] = [];
  if (execCommandMode !== "unavailable") {
    Object.defineProperty(dom.window.document, "execCommand", {
      configurable: true,
      value: (command: string, _showUI: boolean, value?: string): boolean => {
        execCommandCalls.push(command);
        if (execCommandMode === "throw") {
          throw new Error("test execCommand failure");
        }
        if (execCommandMode === "false") {
          return false;
        }
        if (command !== "insertText" || value === undefined) {
          return false;
        }
        const selection = dom.window.document.getSelection();
        if (selection?.rangeCount !== 1) {
          return false;
        }
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const inserted = dom.window.document.createTextNode(value);
        range.insertNode(inserted);
        range.setStartAfter(inserted);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        const anchor = range.startContainer;
        const context =
          anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
        const composer = context?.closest<HTMLElement>(
          '[contenteditable="true"]',
        );
        composer?.dispatchEvent(
          new dom.window.InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: value,
          }),
        );
        return true;
      },
    });
  }
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
    execCommandCalls,
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

type AutolinkMutation =
  | "missing-link-marker"
  | "missing-icon-marker"
  | "link-value-mismatch"
  | "editable-icon"
  | "unknown-icon-descendant"
  | "nonempty-icon";

async function runAutolinkFixture(
  timing: "sync" | "microtask" | "task",
  mutation?: AutolinkMutation,
  clearAfterClick = true,
  transientCopiedMarker = false,
) {
  const markup = await readChatGptFixture("home-composer-autolink.html");
  const installed = installDom(markup);
  try {
    const form = installed.dom.window.document.querySelector(
      'form[data-chatgpt-composer][data-composer-placement="home"]',
    );
    const composer = form?.querySelector(
      '[contenteditable="true"][role="textbox"][data-composer-markdown]',
    );
    const template = form?.querySelector(
      'template[data-fixture="generated-autolink"]',
    );
    assert.ok(form instanceof installed.dom.window.HTMLFormElement);
    assert.ok(composer instanceof installed.dom.window.HTMLElement);
    assert.ok(template instanceof installed.dom.window.HTMLTemplateElement);

    const prompt = transientCopiedMarker
      ? "Before line\n\nSee https://example.invalid/context\nAfter line"
      : "Before line\nSee https://example.invalid/context\nAfter line";
    let clickCount = 0;
    let inputEventCount = 0;
    form.addEventListener("submit", (event) => event.preventDefault());
    composer.addEventListener("input", () => {
      inputEventCount += 1;
      const update = () => {
        if (transientCopiedMarker) {
          const paragraphs = prompt.split("\n").map((line) => {
            const paragraph = installed.dom.window.document.createElement("p");
            if (line.length === 0) {
              paragraph.setAttribute("data-empty-paragraph", "true");
              paragraph.append(
                installed.dom.window.document.createElement("br"),
              );
            } else if (line === "See https://example.invalid/context") {
              const content = template.content.cloneNode(
                true,
              ) as DocumentFragment;
              const clonedLink = content.querySelector(
                "span[data-rich-text-generated-autolink]",
              );
              assert.ok(clonedLink instanceof installed.dom.window.Element);
              paragraph.append(
                installed.dom.window.document.createTextNode("See "),
                clonedLink,
              );
            } else {
              paragraph.append(
                installed.dom.window.document.createTextNode(line),
              );
            }
            return paragraph;
          });
          composer.replaceChildren(...paragraphs);
        } else {
          const content = template.content.cloneNode(true) as DocumentFragment;
          const clonedLink = content.querySelector(
            "span[data-rich-text-generated-autolink]",
          );
          const clonedIcon = content.querySelector(
            "span[data-inline-url-icon]",
          );
          assert.ok(clonedLink instanceof installed.dom.window.Element);
          assert.ok(clonedIcon instanceof installed.dom.window.Element);
          switch (mutation) {
            case "missing-link-marker":
              clonedLink.removeAttribute("data-rich-text-generated-autolink");
              break;
            case "missing-icon-marker":
              clonedIcon.removeAttribute("data-inline-url-icon");
              break;
            case "link-value-mismatch":
              clonedLink.setAttribute(
                "text-link-href",
                "https://example.invalid/different",
              );
              break;
            case "unknown-icon-descendant":
              clonedIcon.append(
                installed.dom.window.document.createElement("img"),
              );
              break;
            case "editable-icon":
              clonedIcon.setAttribute("contenteditable", "true");
              break;
            case "nonempty-icon":
              clonedIcon.append(
                installed.dom.window.document.createTextNode("unexpected"),
              );
              break;
          }
          composer.replaceChildren(content);
        }

        const button = installed.dom.window.document.createElement("button");
        button.type = "submit";
        button.setAttribute("aria-label", "送信");
        button.addEventListener("click", () => {
          clickCount += 1;
          if (clearAfterClick) {
            composer.replaceChildren();
          }
        });
        form.append(button);
      };
      if (transientCopiedMarker) {
        const transientParagraph =
          installed.dom.window.document.createElement("p");
        transientParagraph.setAttribute("data-empty-paragraph", "true");
        transientParagraph.textContent = prompt;
        composer.replaceChildren(transientParagraph);
      }
      if (timing === "microtask") {
        queueMicrotask(update);
      } else if (timing === "task") {
        globalThis.setTimeout(update, 0);
      } else {
        update();
      }
    });

    const result = await runChatGptAdapter(adapterInput(prompt));
    return {
      result,
      clickCount,
      inputEventCount,
      execCommandCalls: installed.execCommandCalls,
      composerText: composer.textContent ?? "",
    };
  } finally {
    installed.cleanup();
  }
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

test("現行 home composer は入力後に現れる同一 form の送信ボタンだけを一度押す", async () => {
  const markup = await readChatGptFixture("home-composer.html");
  const installed = installDom(markup);
  try {
    const form = installed.dom.window.document.querySelector(
      'form[data-chatgpt-composer][data-composer-placement="home"]',
    );
    const composer = form?.querySelector(
      '[contenteditable="true"][role="textbox"][data-composer-markdown]',
    );
    assert.ok(form instanceof installed.dom.window.HTMLFormElement);
    assert.ok(composer instanceof installed.dom.window.HTMLElement);
    assert.equal(
      form.querySelector('button[type="submit"][aria-label="送信"]'),
      null,
    );
    form.addEventListener("submit", (event) => event.preventDefault());

    let clickCount = 0;
    composer.addEventListener("input", () => {
      if (form.querySelector('button[type="submit"][aria-label="送信"]')) {
        return;
      }
      const button = installed.dom.window.document.createElement("button");
      button.type = "submit";
      button.setAttribute("aria-label", "送信");
      button.addEventListener("click", () => {
        clickCount += 1;
        composer.textContent = "";
      });
      form.append(button);
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "sent");
    assert.equal(result.attempted, true);
    assert.equal(result.diagnostics.composerCandidateCount, 1);
    assert.equal(result.diagnostics.sendCandidateCount, 1);
    assert.equal(clickCount, 1);
    assert.equal(composer.textContent, "");
  } finally {
    installed.cleanup();
  }
});

test("contenteditable のnative insertTextが使えない・失敗する場合は一度だけ試し送信しない", async () => {
  for (const mode of ["false", "throw", "unavailable"] as const) {
    const markup = await readChatGptFixture("home-composer.html");
    const installed = installDom(markup, "visible", mode);
    try {
      const composer = installed.dom.window.document.querySelector(
        '[data-composer-markdown][contenteditable="true"]',
      );
      assert.ok(composer instanceof installed.dom.window.HTMLElement);
      let inputEventCount = 0;
      composer.addEventListener("input", () => {
        inputEventCount += 1;
      });
      const result = await runChatGptAdapter(adapterInput());

      assert.equal(result.status, "selector-mismatch", mode);
      assert.equal(result.attempted, false, mode);
      assert.equal(
        result.diagnostics.failureReason,
        "composer-write-unconfirmed",
        mode,
      );
      assert.equal(composer.textContent, "", mode);
      assert.equal(inputEventCount, 0, mode);
      assert.equal(
        installed.dom.window.document.getSelection()?.rangeCount ?? 0,
        0,
        mode,
      );
      assert.deepEqual(
        installed.execCommandCalls,
        mode === "unavailable" ? [] : ["insertText"],
        mode,
      );
    } finally {
      installed.cleanup();
    }
  }
});

test("既存のcontenteditable入力を消さず、insertTextを呼ばない", async () => {
  const markup = await readChatGptFixture("home-composer.html");
  const installed = installDom(markup);
  try {
    const composer = installed.dom.window.document.querySelector(
      '[data-composer-markdown][contenteditable="true"]',
    );
    assert.ok(composer instanceof installed.dom.window.HTMLElement);
    composer.textContent = "existing text";

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.attempted, false);
    assert.equal(
      result.diagnostics.failureReason,
      "composer-write-unconfirmed",
    );
    assert.equal(composer.textContent, "existing text");
    assert.deepEqual(installed.execCommandCalls, []);
  } finally {
    installed.cleanup();
  }
});

test("focus後にcomposerが置換・曖昧・非表示ならinsertTextせず停止する", async () => {
  for (const mode of ["replace", "duplicate", "no-focus", "hide"] as const) {
    const markup = await readChatGptFixture("home-composer.html");
    const installed = installDom(markup);
    try {
      const composer = installed.dom.window.document.querySelector(
        '[data-composer-markdown][contenteditable="true"]',
      );
      assert.ok(composer instanceof installed.dom.window.HTMLElement);
      if (mode === "no-focus") {
        composer.focus = () => undefined;
      } else {
        composer.addEventListener(
          "focus",
          () => {
            if (mode === "hide") {
              Object.defineProperty(
                installed.dom.window.document,
                "visibilityState",
                {
                  configurable: true,
                  value: "hidden",
                },
              );
              return;
            }
            if (mode === "replace") {
              const replacement = composer.cloneNode(true);
              composer.replaceWith(replacement);
              return;
            }
            const form = composer.closest("form");
            assert.ok(form instanceof installed.dom.window.HTMLFormElement);
            form.append(composer.cloneNode(true));
          },
          { once: true },
        );
      }

      const result = await runChatGptAdapter(adapterInput());

      assert.equal(result.status, "selector-mismatch", mode);
      assert.equal(result.attempted, false, mode);
      assert.deepEqual(installed.execCommandCalls, [], mode);
      const expectedFailure = {
        duplicate: "composer-ambiguous",
        hide: "document-not-visible",
        "no-focus": "composer-write-unconfirmed",
        replace: "composer-detached",
      }[mode];
      assert.equal(result.diagnostics.failureReason, expectedFailure, mode);
    } finally {
      installed.cleanup();
    }
  }
});

test("composer外のselectionを消さず、範囲外ならinsertTextしない", async () => {
  for (const mode of ["before-focus", "during-focus"] as const) {
    const markup = await readChatGptFixture("home-composer.html");
    const installed = installDom(markup);
    try {
      const main = installed.dom.window.document.querySelector("main");
      const composer = installed.dom.window.document.querySelector(
        '[data-composer-markdown][contenteditable="true"]',
      );
      assert.ok(main instanceof installed.dom.window.HTMLElement);
      assert.ok(composer instanceof installed.dom.window.HTMLElement);
      const outside = installed.dom.window.document.createElement("p");
      outside.textContent = "outside selection";
      main.prepend(outside);
      const selection = installed.dom.window.document.getSelection();
      assert.ok(selection);
      let originalAnchor: Node | null = null;
      let originalAnchorOffset = -1;
      let originalFocus: Node | null = null;
      let originalFocusOffset = -1;
      const selectOutside = () => {
        selection.removeAllRanges();
        const range = installed.dom.window.document.createRange();
        range.selectNodeContents(outside);
        selection.addRange(range);
        originalAnchor = selection.anchorNode;
        originalAnchorOffset = selection.anchorOffset;
        originalFocus = selection.focusNode;
        originalFocusOffset = selection.focusOffset;
      };
      if (mode === "before-focus") {
        selectOutside();
      } else {
        const nativeFocus = composer.focus.bind(composer);
        composer.focus = () => {
          nativeFocus();
          selectOutside();
        };
      }
      const result = await runChatGptAdapter(adapterInput());

      assert.equal(result.status, "selector-mismatch", mode);
      assert.equal(result.attempted, false, mode);
      assert.equal(
        result.diagnostics.failureReason,
        "composer-write-unconfirmed",
        mode,
      );
      assert.deepEqual(installed.execCommandCalls, [], mode);
      assert.equal(selection.rangeCount, 1, mode);
      assert.equal(selection.anchorNode, originalAnchor, mode);
      assert.equal(selection.anchorOffset, originalAnchorOffset, mode);
      assert.equal(selection.focusNode, originalFocus, mode);
      assert.equal(selection.focusOffset, originalFocusOffset, mode);
      assert.equal(outside.textContent, "outside selection", mode);
      assert.equal(composer.textContent, "", mode);
    } finally {
      installed.cleanup();
    }
  }
});

test("現行 home composer が複数なら入力も送信もしない", async () => {
  const markup = await readChatGptFixture("home-composer.html");
  const installed = installDom(markup);
  try {
    const main = installed.dom.window.document.querySelector("main");
    assert.ok(main instanceof installed.dom.window.HTMLElement);
    const originalForm = main.querySelector("form");
    assert.ok(originalForm instanceof installed.dom.window.HTMLFormElement);
    main.append(originalForm.cloneNode(true));
    const composers = installed.dom.window.document.querySelectorAll(
      'form[data-chatgpt-composer][data-composer-placement="home"] [contenteditable="true"][role="textbox"][data-composer-markdown]',
    );
    assert.equal(composers.length, 2);

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "composer");
    assert.equal(result.diagnostics.failureReason, "composer-ambiguous");
    assert.equal(result.diagnostics.composerCandidateCount, 2);
    assert.equal(result.attempted, false);
    for (const composer of composers) {
      assert.equal(composer.textContent, "");
      assert.equal(composer.closest("form")?.querySelector("button"), null);
    }
  } finally {
    installed.cleanup();
  }
});

test("現行 home form の送信候補が複数なら最初を選ばず送信しない", async () => {
  const markup = await readChatGptFixture("home-composer.html");
  const installed = installDom(markup);
  try {
    const form = installed.dom.window.document.querySelector(
      'form[data-chatgpt-composer][data-composer-placement="home"]',
    );
    const composer = form?.querySelector(
      '[contenteditable="true"][role="textbox"][data-composer-markdown]',
    );
    assert.ok(form instanceof installed.dom.window.HTMLFormElement);
    assert.ok(composer instanceof installed.dom.window.HTMLElement);
    form.addEventListener("submit", (event) => event.preventDefault());

    let clickCount = 0;
    composer.addEventListener("input", () => {
      for (let index = 0; index < 2; index += 1) {
        const button = installed.dom.window.document.createElement("button");
        button.type = "submit";
        button.setAttribute("aria-label", "送信");
        button.addEventListener("click", () => {
          clickCount += 1;
        });
        form.append(button);
      }
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "send");
    assert.equal(result.diagnostics.failureReason, "send-ambiguous");
    assert.equal(result.diagnostics.sendCandidateCount, 2);
    assert.equal(result.attempted, false);
    assert.equal(clickCount, 0);
    assert.equal(composer.textContent, "fixture prompt");
  } finally {
    installed.cleanup();
  }
});

test("generated autolink を同期変換しても全文一致で一度だけ送信する", async () => {
  const {
    result,
    clickCount,
    inputEventCount,
    execCommandCalls,
    composerText,
  } = await runAutolinkFixture("sync");

  assert.equal(result.status, "sent");
  assert.equal(result.attempted, true);
  assert.equal(clickCount, 1);
  assert.equal(inputEventCount, 1);
  assert.deepEqual(execCommandCalls, ["insertText"]);
  assert.equal(composerText, "");
});

test("generated autolink をmicrotask変換しても全文一致で一度だけ送信する", async () => {
  const {
    result,
    clickCount,
    inputEventCount,
    execCommandCalls,
    composerText,
  } = await runAutolinkFixture("microtask");

  assert.equal(result.status, "sent");
  assert.equal(result.attempted, true);
  assert.equal(clickCount, 1);
  assert.equal(inputEventCount, 1);
  assert.deepEqual(execCommandCalls, ["insertText"]);
  assert.equal(composerText, "");
});

test("一時的なempty markerがmicrotaskまたは次のtaskで正規化されてから一度だけ送信する", async () => {
  for (const timing of ["microtask", "task"] as const) {
    const {
      result,
      clickCount,
      inputEventCount,
      execCommandCalls,
      composerText,
    } = await runAutolinkFixture(timing, undefined, true, true);

    assert.equal(result.status, "sent", timing);
    assert.equal(result.attempted, true, timing);
    assert.equal(clickCount, 1, timing);
    assert.equal(inputEventCount, 1, timing);
    assert.deepEqual(execCommandCalls, ["insertText"], timing);
    assert.equal(composerText, "", timing);
  }
});

test("readback待機中に可視性・対象要素・一意性が失われた場合は送信しない", async () => {
  const cases = [
    ["hidden", "document-not-visible"],
    ["detached", "composer-detached"],
    ["ambiguous", "composer-ambiguous"],
  ] as const;
  for (const [mutation, failureReason] of cases) {
    const markup = await readChatGptFixture("home-composer-autolink.html");
    const installed = installDom(markup);
    const delayedActions: ReturnType<typeof setTimeout>[] = [];
    try {
      const document = installed.dom.window.document;
      const form = document.querySelector("form[data-chatgpt-composer]");
      const composer = form?.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"][data-composer-markdown]',
      );
      assert.ok(form instanceof installed.dom.window.HTMLFormElement);
      assert.ok(composer instanceof installed.dom.window.HTMLElement);
      const button = document.createElement("button");
      button.type = "submit";
      button.setAttribute("aria-label", "送信");
      form.append(button);
      let clickCount = 0;
      let duplicate: HTMLElement | null = null;
      button.addEventListener("click", () => {
        clickCount += 1;
      });
      composer.addEventListener("input", () => {
        const paragraph = document.createElement("p");
        paragraph.append(document.createElement("span"));
        composer.replaceChildren(paragraph);
        delayedActions.push(
          globalThis.setTimeout(() => {
            if (mutation === "hidden") {
              Object.defineProperty(document, "visibilityState", {
                configurable: true,
                value: "hidden",
              });
              document.dispatchEvent(
                new installed.dom.window.Event("visibilitychange"),
              );
            } else if (mutation === "detached") {
              composer.remove();
            } else {
              duplicate = composer.cloneNode(false) as HTMLElement;
              form.append(duplicate);
            }
          }, 0),
        );
        delayedActions.push(
          globalThis.setTimeout(() => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "visible",
            });
            if (mutation === "detached") {
              form.append(composer);
            } else if (mutation === "ambiguous") {
              duplicate?.remove();
            }
            composer.replaceChildren(
              document.createTextNode("target boundary check"),
            );
          }, 20),
        );
      });

      const result = await runChatGptAdapter(
        adapterInput("target boundary check"),
      );

      assert.equal(result.status, "selector-mismatch", mutation);
      assert.equal(result.diagnostics.failureReason, failureReason, mutation);
      assert.equal(result.attempted, false, mutation);
      assert.equal(clickCount, 0, mutation);
      assert.deepEqual(installed.execCommandCalls, ["insertText"], mutation);
    } finally {
      for (const timer of delayedActions) {
        globalThis.clearTimeout(timer);
      }
      installed.cleanup();
    }
  }
});

test("generated autolink のmarker・リンク値・icon・構造が不正なら送信しない", async () => {
  const mutations: AutolinkMutation[] = [
    "missing-link-marker",
    "missing-icon-marker",
    "link-value-mismatch",
    "editable-icon",
    "unknown-icon-descendant",
    "nonempty-icon",
  ];
  for (const mutation of mutations) {
    const { result, clickCount, execCommandCalls, composerText } =
      await runAutolinkFixture("sync", mutation);

    assert.equal(result.status, "selector-mismatch", mutation);
    assert.equal(result.phase, "composer", mutation);
    assert.equal(
      result.diagnostics.failureReason,
      "composer-input-structure-unsupported",
      mutation,
    );
    assert.equal(result.attempted, false, mutation);
    assert.equal(clickCount, 0, mutation);
    assert.deepEqual(execCommandCalls, ["insertText"], mutation);
    assert.notEqual(composerText, "", mutation);
  }
});

test("送信後もautolink composerが残る場合はsend-unknownで終端する", async () => {
  const { result, clickCount, composerText } = await runAutolinkFixture(
    "sync",
    undefined,
    false,
  );

  assert.equal(result.status, "send-unknown");
  assert.equal(result.diagnostics.failureReason, "send-result-unknown");
  assert.equal(result.attempted, true);
  assert.equal(clickCount, 1);
  assert.ok(
    composerText.includes(
      "Before line\nSee https://example.invalid/context\nAfter line",
    ),
  );
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

test("contenteditable の ProseMirror 段落を復元して複数行と空行を一度だけ送信する", async () => {
  const prompt = "first line\n\nthird line";
  const installed = installDom(`
    <!doctype html>
    <html>
      <body>
        <div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>
        <button data-testid="send-button" type="button">Send</button>
      </body>
    </html>
  `);
  try {
    const composer =
      installed.dom.window.document.querySelector("#prompt-textarea");
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(composer instanceof installed.dom.window.HTMLElement);
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);

    composer.addEventListener("input", () => {
      queueMicrotask(() => {
        composer.replaceChildren(
          ...prompt.split("\n").map((line) => {
            const paragraph = installed.dom.window.document.createElement("p");
            if (line.length === 0) {
              paragraph.setAttribute("data-empty-paragraph", "true");
              paragraph.append(
                installed.dom.window.document.createElement("br"),
              );
            } else {
              paragraph.append(
                installed.dom.window.document.createTextNode(line),
              );
            }
            return paragraph;
          }),
        );
      });
    });

    let clickCount = 0;
    let submittedParagraphs: Array<{
      readonly text: string;
      readonly empty: boolean;
    }> = [];
    button.addEventListener("click", () => {
      clickCount += 1;
      submittedParagraphs = Array.from(composer.children).map((paragraph) => ({
        text: paragraph.textContent ?? "",
        empty: paragraph.hasAttribute("data-empty-paragraph"),
      }));
      composer.replaceChildren();
    });

    const result = await runChatGptAdapter(adapterInput(prompt));

    assert.equal(result.status, "sent");
    assert.equal(result.attempted, true);
    assert.equal(clickCount, 1);
    assert.deepEqual(submittedParagraphs, [
      { text: "first line", empty: false },
      { text: "", empty: true },
      { text: "third line", empty: false },
    ]);
  } finally {
    installed.cleanup();
  }
});

test("contenteditable の readback が一文字でも変われば送信しない", async () => {
  const prompt = "first line\n\nthird line";
  const installed = installDom(`
    <!doctype html>
    <html>
      <body>
        <div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>
        <button data-testid="send-button" type="button">Send</button>
      </body>
    </html>
  `);
  try {
    const composer =
      installed.dom.window.document.querySelector("#prompt-textarea");
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(composer instanceof installed.dom.window.HTMLElement);
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);
    composer.addEventListener("input", () => {
      queueMicrotask(() => {
        composer.replaceChildren(
          ...prompt.split("\n").map((line, index) => {
            const paragraph = installed.dom.window.document.createElement("p");
            if (line.length === 0) {
              paragraph.setAttribute("data-empty-paragraph", "true");
              paragraph.append(
                installed.dom.window.document.createElement("br"),
              );
            } else {
              paragraph.append(
                installed.dom.window.document.createTextNode(
                  index === 0 ? "first linx" : line,
                ),
              );
            }
            return paragraph;
          }),
        );
      });
    });

    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
    });

    const result = await runChatGptAdapter(adapterInput(prompt));

    assert.equal(result.status, "selector-mismatch");
    assert.equal(
      result.diagnostics.failureReason,
      "composer-presend-text-mismatch",
    );
    assert.equal(result.attempted, false);
    assert.equal(clickCount, 0);
  } finally {
    installed.cleanup();
  }
});

test("contenteditable に予期しない構造が入った場合は一致扱いにせず送信しない", async () => {
  const prompt = "first line\n\nthird line";
  const installed = installDom(`
    <!doctype html>
    <html>
      <body>
        <div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>
        <button data-testid="send-button" type="button">Send</button>
      </body>
    </html>
  `);
  try {
    const composer =
      installed.dom.window.document.querySelector("#prompt-textarea");
    const button = installed.dom.window.document.querySelector(
      'button[data-testid="send-button"]',
    );
    assert.ok(composer instanceof installed.dom.window.HTMLElement);
    assert.ok(button instanceof installed.dom.window.HTMLButtonElement);
    composer.addEventListener("input", () => {
      queueMicrotask(() => {
        composer.replaceChildren(
          ...prompt.split("\n").map((line, index) => {
            const paragraph = installed.dom.window.document.createElement("p");
            if (line.length === 0) {
              paragraph.setAttribute("data-empty-paragraph", "true");
              paragraph.append(
                installed.dom.window.document.createElement("br"),
              );
            } else if (index === 0) {
              const unexpected =
                installed.dom.window.document.createElement("span");
              unexpected.textContent = line;
              paragraph.append(unexpected);
            } else {
              paragraph.append(
                installed.dom.window.document.createTextNode(line),
              );
            }
            return paragraph;
          }),
        );
      });
    });

    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
    });

    const result = await runChatGptAdapter(adapterInput(prompt));

    assert.equal(result.status, "selector-mismatch");
    assert.equal(
      result.diagnostics.failureReason,
      "composer-presend-structure-unsupported",
    );
    assert.equal(result.attempted, false);
    assert.equal(clickCount, 0);
  } finally {
    installed.cleanup();
  }
});

test("hidden document では composer 書き込みと send click を行わず終了する", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup, "hidden");
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
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "composer");
    assert.equal(result.attempted, false);
    assert.equal(result.diagnostics.visibilityState, "hidden");
    assert.equal(result.diagnostics.failureReason, "document-not-visible");
    assert.equal(textarea.value, "");
    assert.equal(clickCount, 0);
  } finally {
    installed.cleanup();
  }
});

test("composer 書き込み前に hidden 化した場合は書き込みと送信を行わず終了する", async () => {
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

    let visibilityReads = 0;
    Object.defineProperty(installed.dom.window.document, "visibilityState", {
      configurable: true,
      get: () => {
        visibilityReads += 1;
        return visibilityReads <= 2 ? "visible" : "hidden";
      },
    });
    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "composer");
    assert.equal(result.attempted, false);
    assert.equal(result.diagnostics.visibilityState, "hidden");
    assert.equal(result.diagnostics.failureReason, "document-not-visible");
    assert.equal(textarea.value, "");
    assert.equal(clickCount, 0);
  } finally {
    installed.cleanup();
  }
});

test("書き込み後 send click 前に hidden 化した場合は再操作せず prompt を残す", async () => {
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

    let hidden = false;
    Object.defineProperty(installed.dom.window.document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    textarea.addEventListener("input", () => {
      hidden = true;
    });
    let clickCount = 0;
    button.addEventListener("click", () => {
      clickCount += 1;
    });

    const result = await runChatGptAdapter(adapterInput());

    assert.equal(result.status, "selector-mismatch");
    assert.equal(result.phase, "send");
    assert.equal(result.attempted, false);
    assert.equal(result.diagnostics.visibilityState, "hidden");
    assert.equal(result.diagnostics.failureReason, "document-not-visible");
    assert.equal(textarea.value, "fixture prompt");
    assert.equal(clickCount, 0);
  } finally {
    installed.cleanup();
  }
});

test("visible document で handler が未準備なら一度の click 後に send-unknown となる", async () => {
  const markup = await readChatGptFixture("composer.html");
  const installed = installDom(markup);
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
    assert.equal(result.diagnostics.visibilityState, "visible");
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
      "composer-input-text-mismatch",
    );
    assert.equal(clickCount, 0);
  } finally {
    installed.cleanup();
  }
});

test("送信直前の読み戻し失敗は構造と文字列を区別し、clickしない", async () => {
  for (const mode of ["unsupported", "mismatch"] as const) {
    const markup = await readChatGptFixture("home-composer.html");
    const installed = installDom(markup);
    try {
      const composer = installed.dom.window.document.querySelector(
        '[data-composer-markdown][contenteditable="true"]',
      );
      const form = composer?.closest("form");
      assert.ok(composer instanceof installed.dom.window.HTMLElement);
      assert.ok(form instanceof installed.dom.window.HTMLFormElement);
      const sendButton = installed.dom.window.document.createElement("button");
      sendButton.type = "submit";
      sendButton.setAttribute("aria-label", "送信");
      form.append(sendButton);
      assert.ok(sendButton instanceof installed.dom.window.HTMLButtonElement);

      composer.addEventListener("input", () => {
        queueMicrotask(() => {
          if (mode === "mismatch") {
            composer.textContent = "changed text";
            return;
          }
          const paragraph = installed.dom.window.document.createElement("p");
          const unknown = installed.dom.window.document.createElement("span");
          unknown.textContent = "changed structure";
          paragraph.append(unknown);
          composer.replaceChildren(paragraph);
        });
      });

      let clickCount = 0;
      sendButton.addEventListener("click", () => {
        clickCount += 1;
      });

      const result = await runChatGptAdapter(adapterInput());

      assert.equal(result.status, "selector-mismatch", mode);
      assert.equal(result.attempted, false, mode);
      assert.equal(
        result.diagnostics.failureReason,
        mode === "unsupported"
          ? "composer-presend-structure-unsupported"
          : "composer-presend-text-mismatch",
        mode,
      );
      assert.equal(clickCount, 0, mode);
    } finally {
      installed.cleanup();
    }
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
