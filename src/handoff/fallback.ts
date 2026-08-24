import type { ChatGptAdapterStatus } from "../destinations/chatgpt/adapter.js";
import type { ChatGptBannerInput } from "../destinations/chatgpt/banner.js";
import {
  CLIPBOARD_WRITE_MESSAGE,
  type ClipboardWriteRequest,
  type ClipboardWriteResponse,
} from "../offscreen/clipboard.js";

export interface OffscreenClipboardPort {
  hasDocument(): Promise<boolean>;
  createDocument(): Promise<void>;
  closeDocument(): Promise<void>;
  writeText(request: ClipboardWriteRequest): Promise<ClipboardWriteResponse>;
}

export interface FallbackBannerPort {
  show(tabId: number, input: ChatGptBannerInput): Promise<void>;
}

export interface ClipboardFallbackDependencies {
  readonly offscreen: OffscreenClipboardPort;
  readonly banner?: FallbackBannerPort;
}

export interface ClipboardFallbackRequest {
  readonly requestId: string;
  readonly tabId: number;
  readonly prompt: string;
  readonly cause: Exclude<ChatGptAdapterStatus, "sent" | "invalid-input">;
}

export type ClipboardFallbackStatus =
  | "copied"
  | "clipboard-failed"
  | "invalid-request";

export interface ClipboardFallbackResult {
  readonly status: ClipboardFallbackStatus;
  readonly bannerShown: boolean;
  readonly reason?: string;
}

function bannerKindFor(
  status: ClipboardFallbackStatus,
  cause: ClipboardFallbackRequest["cause"],
): ChatGptBannerInput["kind"] {
  if (status === "copied" && cause === "send-unknown") {
    return "send-unknown";
  }
  return status === "copied" ? "clipboard-copied" : "clipboard-failed";
}

/**
 * Create a serial, injectable clipboard fallback coordinator.
 *
 * The queue is deliberately scoped to this coordinator instance. It prevents
 * concurrent offscreen create/write/close races without persisting prompt data
 * or relying on a process-global lock. The service worker can construct one
 * coordinator during startup and its session state remains the source of
 * truth across worker restarts.
 */
export function createClipboardFallbackCoordinator(
  dependencies: ClipboardFallbackDependencies,
): {
  run(request: ClipboardFallbackRequest): Promise<ClipboardFallbackResult>;
} {
  let tail: Promise<void> = Promise.resolve();

  const runOnce = async (
    request: ClipboardFallbackRequest,
  ): Promise<ClipboardFallbackResult> => {
    if (
      request.requestId.length === 0 ||
      request.requestId.length > 128 ||
      !Number.isSafeInteger(request.tabId) ||
      request.tabId < 0 ||
      request.prompt.length === 0
    ) {
      return {
        status: "invalid-request",
        bannerShown: false,
        reason: "fallback request is empty or malformed",
      };
    }

    let shouldClose = false;
    let status: ClipboardFallbackStatus = "clipboard-failed";
    let reason: string | undefined;
    try {
      let available = await dependencies.offscreen.hasDocument();
      shouldClose = available;
      if (!available) {
        try {
          await dependencies.offscreen.createDocument();
          shouldClose = true;
        } catch {
          // Another extension event may have created the same document between
          // the check and create call. Confirm before reporting failure.
          available = await dependencies.offscreen.hasDocument();
          if (!available) {
            reason = "offscreen document could not be created";
          }
        }
      }
      if (!available && shouldClose) {
        available = await dependencies.offscreen.hasDocument();
      }
      if (!available) {
        return {
          status,
          bannerShown: await showBanner(
            dependencies.banner,
            request.tabId,
            bannerKindFor(status, request.cause),
          ),
          ...(reason ? { reason } : {}),
        };
      }

      const response = await dependencies.offscreen.writeText({
        type: CLIPBOARD_WRITE_MESSAGE,
        requestId: request.requestId,
        text: request.prompt,
      });
      if (response.ok) {
        status = "copied";
      } else {
        reason = response.reason;
      }
    } catch {
      reason = "clipboard fallback failed";
    } finally {
      if (shouldClose) {
        try {
          await dependencies.offscreen.closeDocument();
        } catch {
          // Closing is best effort. The prompt is never retried because the
          // write operation above has already reached a terminal state.
        }
      }
    }

    const bannerShown = await showBanner(
      dependencies.banner,
      request.tabId,
      bannerKindFor(status, request.cause),
    );
    return {
      status,
      bannerShown,
      ...(reason ? { reason } : {}),
    };
  };

  const run = (
    request: ClipboardFallbackRequest,
  ): Promise<ClipboardFallbackResult> => {
    const operation = tail.then(() => runOnce(request));
    tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  return { run };
}

async function showBanner(
  banner: FallbackBannerPort | undefined,
  tabId: number,
  kind: ChatGptBannerInput["kind"],
): Promise<boolean> {
  if (!banner) {
    return false;
  }
  try {
    await banner.show(tabId, { kind });
    return true;
  } catch {
    return false;
  }
}
