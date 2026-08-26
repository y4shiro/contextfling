export const CLIPBOARD_WRITE_MESSAGE = "contextfling:clipboard-write" as const;

export interface ClipboardWriteRequest {
  readonly type: typeof CLIPBOARD_WRITE_MESSAGE;
  readonly requestId: string;
  readonly text: string;
}

export type ClipboardWriteFailure =
  | "invalid-request"
  | "duplicate-request"
  | "clipboard-unavailable"
  | "write-failed"
  | "response-failed";

export interface ClipboardWriteSuccess {
  readonly ok: true;
}

export interface ClipboardWriteError {
  readonly ok: false;
  readonly reason: ClipboardWriteFailure;
}

export type ClipboardWriteResponse =
  | ClipboardWriteSuccess
  | ClipboardWriteError;

const CLIPBOARD_WRITE_FAILURES: readonly ClipboardWriteFailure[] = [
  "invalid-request",
  "duplicate-request",
  "clipboard-unavailable",
  "write-failed",
  "response-failed",
];

/**
 * Validate a response crossing the runtime-message boundary.
 *
 * The service worker treats an absent or malformed response as a terminal
 * response failure. Keeping this check in the offscreen module gives the
 * fallback coordinator the same typed boundary without exposing any payload
 * contents in diagnostics.
 */
export function isClipboardWriteResponse(
  value: unknown,
): value is ClipboardWriteResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.ok === true ||
    (record.ok === false &&
      typeof record.reason === "string" &&
      CLIPBOARD_WRITE_FAILURES.includes(record.reason as ClipboardWriteFailure))
  );
}

export interface ClipboardWriter {
  readonly body: {
    appendChild(node: ClipboardTextArea): void;
    removeChild(node: ClipboardTextArea): void;
  } | null;
  createElement(tagName: string): ClipboardTextArea;
  execCommand(command: string): boolean;
}

export interface ClipboardTextArea {
  value: string;
  select(): void;
}

export interface RuntimeMessagePort {
  readonly onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: ClipboardWriteResponse) => void,
      ) => boolean | undefined,
    ): void;
    removeListener?(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: ClipboardWriteResponse) => void,
      ) => boolean | undefined,
    ): void;
  };
}

function isClipboardWriteRequest(
  message: unknown,
): message is ClipboardWriteRequest {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const record = message as Record<string, unknown>;
  return (
    record.type === CLIPBOARD_WRITE_MESSAGE &&
    typeof record.requestId === "string" &&
    record.requestId.length > 0 &&
    record.requestId.length <= 128 &&
    typeof record.text === "string" &&
    record.text.length > 0
  );
}

function isClipboardDom(value: unknown): value is ClipboardWriter {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const body = record.body;
  if (typeof record.createElement !== "function") {
    return false;
  }
  if (typeof record.execCommand !== "function") {
    return false;
  }
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const bodyRecord = body as Record<string, unknown>;
  return (
    typeof bodyRecord.appendChild === "function" &&
    typeof bodyRecord.removeChild === "function"
  );
}

function isClipboardTextArea(value: unknown): value is ClipboardTextArea {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.value === "string" && typeof record.select === "function"
  );
}

export async function writeTextOnce(
  text: string,
  clipboard: ClipboardWriter | undefined,
): Promise<ClipboardWriteResponse> {
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    !isClipboardDom(clipboard)
  ) {
    return { ok: false, reason: "clipboard-unavailable" };
  }
  const body = clipboard.body;
  if (!body) {
    return { ok: false, reason: "clipboard-unavailable" };
  }

  let textarea: ClipboardTextArea | undefined;
  let appended = false;
  let response: ClipboardWriteResponse = {
    ok: false,
    reason: "write-failed",
  };
  try {
    textarea = clipboard.createElement("textarea");
    if (!isClipboardTextArea(textarea)) {
      return { ok: false, reason: "clipboard-unavailable" };
    }
    textarea.value = text;
    body.appendChild(textarea);
    appended = true;
    textarea.select();
    response = clipboard.execCommand("copy")
      ? { ok: true }
      : { ok: false, reason: "write-failed" };
  } catch {
    response = { ok: false, reason: "write-failed" };
  } finally {
    if (textarea) {
      try {
        textarea.value = "";
      } catch {
        response = { ok: false, reason: "write-failed" };
      }
    }
    if (textarea && appended) {
      try {
        body.removeChild(textarea);
      } catch {
        response = { ok: false, reason: "write-failed" };
      }
    }
  }
  return response;
}

/**
 * Install the one-shot message handler used by the bundled offscreen page.
 * Duplicate request IDs are rejected for the lifetime of this document, so a
 * caller cannot accidentally write the same prompt twice through one page.
 */
export function installClipboardMessageHandler(
  runtime: RuntimeMessagePort,
  clipboard: ClipboardWriter | undefined,
): () => void {
  const handledRequestIds = new Set<string>();
  const listener = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: ClipboardWriteResponse) => void,
  ): boolean => {
    if (!isClipboardWriteRequest(message)) {
      return false;
    }
    if (handledRequestIds.has(message.requestId)) {
      sendResponse({ ok: false, reason: "duplicate-request" });
      return false;
    }
    handledRequestIds.add(message.requestId);
    void (async () => {
      const response = await writeTextOnce(message.text, clipboard);
      try {
        sendResponse(response);
      } catch {
        // The sender may have gone away. The request remains handled and is
        // intentionally not retried.
      }
    })();
    return true;
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener?.(listener);
}
