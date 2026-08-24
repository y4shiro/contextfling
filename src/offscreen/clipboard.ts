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

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
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

export async function writeTextOnce(
  text: string,
  clipboard: ClipboardWriter | undefined,
): Promise<ClipboardWriteResponse> {
  if (text.length === 0 || !clipboard) {
    return { ok: false, reason: "clipboard-unavailable" };
  }
  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
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
