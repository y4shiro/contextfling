import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ClipboardFallbackRequest,
  createClipboardFallbackCoordinator,
  type OffscreenClipboardPort,
} from "../src/handoff/fallback.js";
import {
  type ClipboardWriteResponse,
  type ClipboardWriter,
  installClipboardMessageHandler,
  type RuntimeMessagePort,
  writeTextOnce,
} from "../src/offscreen/clipboard.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("offscreen は static HTML と runtime messaging だけで clipboard を扱う", async () => {
  const [html, source, entrySource] = await Promise.all([
    readFile(resolve(projectRoot, "src/offscreen/offscreen.html"), "utf8"),
    readFile(resolve(projectRoot, "src/offscreen/clipboard.ts"), "utf8"),
    readFile(resolve(projectRoot, "src/offscreen/entry.ts"), "utf8"),
  ]);
  assert.match(html, /<script[^>]+src="offscreen\.js"/);
  assert.doesNotMatch(html, /<script[^>]*>\s*[^<\s]/i);
  assert.match(source, /CLIPBOARD_WRITE_MESSAGE/);
  assert.match(source, /ClipboardWriter/);
  assert.match(source, /runtime\.onMessage/);
  assert.match(source, /writeTextOnce/);
  assert.doesNotMatch(source, /navigator\.clipboard/);
  assert.doesNotMatch(entrySource, /navigator\.clipboard/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /chrome\.tabs|chrome\.scripting/);
});

test("offscreen message handler は request ID の重複と失敗を型付きで返す", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/offscreen/clipboard.ts"),
    "utf8",
  );
  assert.match(source, /handledRequestIds/);
  assert.match(source, /duplicate-request/);
  assert.match(source, /write-failed/);
  assert.match(source, /sendResponse\(response\)/);
  assert.match(source, /return true/);
});

test("fallback coordinator は offscreen create/write/close の同時実行を直列化する", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/handoff/fallback.ts"),
    "utf8",
  );
  assert.match(source, /hasDocument\(\)/);
  assert.match(source, /createDocument\(\)/);
  assert.match(source, /closeDocument\(\)/);
  assert.match(source, /let tail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(source, /tail\.then/);
  assert.match(source, /CLIPBOARD_WRITE_MESSAGE/);
  assert.doesNotMatch(source, /chrome\.storage/);
  assert.doesNotMatch(source, /globalThis\.[A-Za-z]+Lock/);
});

test("clipboard failure は prompt を保存せず banner へ明示的に渡す", async () => {
  const source = await readFile(
    resolve(projectRoot, "src/handoff/fallback.ts"),
    "utf8",
  );
  assert.match(source, /clipboard-failed/);
  assert.match(source, /showBanner/);
  assert.match(source, /bannerShown/);
  assert.match(source, /writeText\(\{/);
  assert.doesNotMatch(source, /storage\.local|storage\.session/);
});

function fallbackRequest(requestId = "request-1"): ClipboardFallbackRequest {
  return {
    requestId,
    tabId: 7,
    prompt: "opaque test payload",
    cause: "selector-mismatch",
  };
}

function bannerRecorder(): {
  readonly calls: Array<{ tabId: number; kind: string }>;
  readonly port: {
    show(tabId: number, input: { kind: string }): Promise<void>;
  };
} {
  const calls: Array<{ tabId: number; kind: string }> = [];
  return {
    calls,
    port: {
      async show(tabId, input): Promise<void> {
        calls.push({ tabId, kind: input.kind });
      },
    },
  };
}

function coordinator(offscreen: OffscreenClipboardPort) {
  return createClipboardFallbackCoordinator({
    offscreen,
    banner: bannerRecorder().port,
  });
}

test("offscreen 未作成のまま create が失敗した場合は write せず typed category を返す", async () => {
  let writeCalls = 0;
  let closeCalls = 0;
  const fallback = coordinator({
    hasDocument: async () => false,
    createDocument: async () => {
      throw new Error("create rejected");
    },
    closeDocument: async () => {
      closeCalls += 1;
    },
    writeText: async () => {
      writeCalls += 1;
      return { ok: true };
    },
  });

  const result = await fallback.run(fallbackRequest());

  assert.equal(result.status, "clipboard-failed");
  assert.equal(result.reason, "offscreen-not-created");
  assert.equal(result.failureCategory, "offscreen-not-created");
  assert.equal(writeCalls, 0);
  assert.equal(closeCalls, 0);
});

test("offscreen create race は既存 document を閉じず、write は一度だけ行う", async () => {
  let hasCalls = 0;
  let createCalls = 0;
  let writeCalls = 0;
  let closeCalls = 0;
  const fallback = coordinator({
    hasDocument: async () => {
      hasCalls += 1;
      return hasCalls > 1;
    },
    createDocument: async () => {
      createCalls += 1;
      throw new Error("already exists");
    },
    closeDocument: async () => {
      closeCalls += 1;
    },
    writeText: async () => {
      writeCalls += 1;
      return { ok: true };
    },
  });

  const result = await fallback.run(fallbackRequest());

  assert.equal(result.status, "copied");
  assert.equal(result.reason, undefined);
  assert.equal(result.failureCategory, undefined);
  assert.equal(result.lifecycleCategory, "offscreen-create-race");
  assert.equal(createCalls, 1);
  assert.equal(writeCalls, 1);
  assert.equal(closeCalls, 0);
});

test("create 成功後に document を確認できなければ write せず close する", async () => {
  let hasCalls = 0;
  let writeCalls = 0;
  let closeCalls = 0;
  const fallback = coordinator({
    hasDocument: async () => {
      hasCalls += 1;
      return false;
    },
    createDocument: async () => undefined,
    closeDocument: async () => {
      closeCalls += 1;
    },
    writeText: async () => {
      writeCalls += 1;
      return { ok: true };
    },
  });

  const result = await fallback.run(fallbackRequest());

  assert.equal(result.status, "clipboard-failed");
  assert.equal(result.reason, "offscreen-unavailable-after-create");
  assert.equal(hasCalls, 2);
  assert.equal(writeCalls, 0);
  assert.equal(closeCalls, 1);
});

test("clipboard unavailable と write rejection は response category をそのまま区別する", async () => {
  let response: {
    readonly ok: false;
    readonly reason: "clipboard-unavailable" | "write-failed";
  } = {
    ok: false,
    reason: "clipboard-unavailable",
  };
  const fallback = coordinator({
    hasDocument: async () => true,
    createDocument: async () => undefined,
    closeDocument: async () => undefined,
    writeText: async () => response,
  });

  const unavailable = await fallback.run(fallbackRequest("unavailable"));
  response = { ok: false, reason: "write-failed" };
  const rejected = await fallback.run(fallbackRequest("rejected"));

  assert.equal(unavailable.reason, "clipboard-unavailable");
  assert.equal(unavailable.failureCategory, "clipboard-unavailable");
  assert.equal(rejected.reason, "write-failed");
  assert.equal(rejected.failureCategory, "write-failed");
});

test("response 不在 typed union または runtime message reject の場合は response-failed", async () => {
  let rejectWrite = false;
  const fallback = coordinator({
    hasDocument: async () => true,
    createDocument: async () => undefined,
    closeDocument: async () => undefined,
    writeText: async () => {
      if (rejectWrite) {
        throw new Error("runtime response unavailable");
      }
      return undefined as never;
    },
  });

  const malformed = await fallback.run(fallbackRequest("malformed"));
  rejectWrite = true;
  const rejected = await fallback.run(fallbackRequest("response-rejected"));

  assert.equal(malformed.reason, "response-failed");
  assert.equal(malformed.failureCategory, "response-failed");
  assert.equal(rejected.reason, "response-failed");
  assert.equal(rejected.failureCategory, "response-failed");
});

test("created document の close failure は write 後の terminal category として返す", async () => {
  let hasCalls = 0;
  let writeCalls = 0;
  let closeCalls = 0;
  const fallback = coordinator({
    hasDocument: async () => {
      hasCalls += 1;
      return hasCalls > 1;
    },
    createDocument: async () => undefined,
    closeDocument: async () => {
      closeCalls += 1;
      throw new Error("close rejected");
    },
    writeText: async () => {
      writeCalls += 1;
      return { ok: true };
    },
  });

  const result = await fallback.run(fallbackRequest());

  assert.equal(result.status, "copied");
  assert.equal(result.reason, "close-failed");
  assert.equal(result.failureCategory, "close-failed");
  assert.equal(result.cleanupFailureCategory, "close-failed");
  assert.equal(writeCalls, 1);
  assert.equal(closeCalls, 1);
});

test("coordinator は concurrent fallback を直列化し、各 request の write を一度だけ行う", async () => {
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  let writeCalls = 0;
  const fallback = coordinator({
    hasDocument: async () => true,
    createDocument: async () => undefined,
    closeDocument: async () => undefined,
    writeText: async () => {
      writeCalls += 1;
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      activeWrites -= 1;
      return { ok: true };
    },
  });

  await Promise.all([
    fallback.run(fallbackRequest("serial-1")),
    fallback.run(fallbackRequest("serial-2")),
  ]);

  assert.equal(maximumActiveWrites, 1);
  assert.equal(writeCalls, 2);
});

test("offscreen writer は DOM copy の成功・false・throw と cleanup を一度だけ実行する", async () => {
  assert.deepEqual(await writeTextOnce("", undefined), {
    ok: false,
    reason: "clipboard-unavailable",
  });
  assert.deepEqual(
    await writeTextOnce("opaque test payload", {
      body: null,
      createElement: () => ({ value: "", select: () => undefined }),
      execCommand: () => true,
    }),
    { ok: false, reason: "clipboard-unavailable" },
  );

  type TextArea = { value: string; select(): void };
  const textarea: TextArea = {
    value: "",
    select() {},
  };
  let appendCalls = 0;
  let removeCalls = 0;
  let execCalls = 0;
  let copyResult = true;
  let throwOnCopy = false;
  const clipboard: ClipboardWriter = {
    body: {
      appendChild(node) {
        assert.equal(node, textarea);
        appendCalls += 1;
      },
      removeChild(node) {
        assert.equal(node, textarea);
        removeCalls += 1;
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "textarea");
      return textarea;
    },
    execCommand(command) {
      assert.equal(command, "copy");
      execCalls += 1;
      if (throwOnCopy) {
        throw new Error("copy rejected");
      }
      return copyResult;
    },
  };

  assert.deepEqual(await writeTextOnce("opaque test payload", clipboard), {
    ok: true,
  });
  assert.equal(execCalls, 1);
  assert.equal(appendCalls, 1);
  assert.equal(removeCalls, 1);
  assert.equal(textarea.value, "");

  copyResult = false;
  assert.deepEqual(await writeTextOnce("opaque test payload", clipboard), {
    ok: false,
    reason: "write-failed",
  });
  assert.equal(execCalls, 2);
  assert.equal(appendCalls, 2);
  assert.equal(removeCalls, 2);
  assert.equal(textarea.value, "");

  throwOnCopy = true;
  assert.deepEqual(await writeTextOnce("opaque test payload", clipboard), {
    ok: false,
    reason: "write-failed",
  });
  assert.equal(execCalls, 3);
  assert.equal(appendCalls, 3);
  assert.equal(removeCalls, 3);
  assert.equal(textarea.value, "");
});

test("offscreen writer は clipboard unavailable と handler の duplicate request を返す", async () => {
  assert.deepEqual(await writeTextOnce("opaque test payload", undefined), {
    ok: false,
    reason: "clipboard-unavailable",
  });

  type Listener = Parameters<RuntimeMessagePort["onMessage"]["addListener"]>[0];
  let listener: Listener | undefined;
  let writes = 0;
  const responses: ClipboardWriteResponse[] = [];
  const removeCalls: Listener[] = [];
  const cleanup = installClipboardMessageHandler(
    {
      onMessage: {
        addListener(value) {
          listener = value;
        },
        removeListener(value) {
          removeCalls.push(value);
        },
      },
    },
    {
      body: {
        appendChild: () => undefined,
        removeChild: () => undefined,
      },
      createElement: () => ({ value: "", select: () => undefined }),
      execCommand: () => {
        writes += 1;
        return true;
      },
    },
  );
  assert.ok(listener);
  assert.equal(
    listener?.(
      {
        type: "contextfling:clipboard-write",
        requestId: "duplicate-check",
        text: "opaque test payload",
      },
      {},
      (response) => responses.push(response),
    ),
    true,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    listener?.(
      {
        type: "contextfling:clipboard-write",
        requestId: "duplicate-check",
        text: "opaque test payload",
      },
      {},
      (response) => responses.push(response),
    ),
    false,
  );
  assert.equal(writes, 1);
  assert.deepEqual(responses.at(-1), {
    ok: false,
    reason: "duplicate-request",
  });
  cleanup();
  assert.equal(removeCalls.length, 1);
});
