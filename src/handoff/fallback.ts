import type { ChatGptAdapterStatus } from "../destinations/chatgpt/adapter.js";
import type { ChatGptBannerInput } from "../destinations/chatgpt/banner.js";
import {
  CLIPBOARD_WRITE_MESSAGE,
  type ClipboardWriteFailure,
  type ClipboardWriteRequest,
  type ClipboardWriteResponse,
  isClipboardWriteResponse,
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

/**
 * Non-sensitive categories for the one-shot fallback boundary.
 *
 * `ClipboardWriteFailure` describes the runtime message / Clipboard API side;
 * the additional categories describe the offscreen document lifecycle. The
 * union is deliberately finite so callers cannot accidentally surface a
 * thrown error or user data as a diagnostic reason.
 */
export type ClipboardFallbackFailureCategory =
  | "invalid-request"
  | "offscreen-not-created"
  | "offscreen-unavailable-after-create"
  | ClipboardWriteFailure
  | "close-failed";

export type ClipboardFallbackLifecycleCategory = "offscreen-create-race";

export interface ClipboardFallbackResult {
  readonly status: ClipboardFallbackStatus;
  readonly bannerShown: boolean;
  /** A stable, non-sensitive category for the terminal operation. */
  readonly reason?: ClipboardFallbackFailureCategory;
  /** Explicit alias for consumers that need to distinguish it from prose. */
  readonly failureCategory?: ClipboardFallbackFailureCategory;
  /** A close failure can accompany a primary write failure. */
  readonly cleanupFailureCategory?: "close-failed";
  /** A recovered lifecycle condition that did not itself fail the write. */
  readonly lifecycleCategory?: ClipboardFallbackLifecycleCategory;
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
      typeof request?.requestId !== "string" ||
      typeof request?.prompt !== "string" ||
      request.requestId.length === 0 ||
      request.requestId.length > 128 ||
      !Number.isSafeInteger(request.tabId) ||
      request.tabId < 0 ||
      request.prompt.length === 0
    ) {
      return {
        status: "invalid-request",
        bannerShown: false,
        reason: "invalid-request",
        failureCategory: "invalid-request",
      };
    }

    let createdDocument = false;
    let status: ClipboardFallbackStatus = "clipboard-failed";
    let failureCategory: ClipboardFallbackFailureCategory | undefined;
    let cleanupFailureCategory: "close-failed" | undefined;
    let creationFailureCategory:
      | "offscreen-not-created"
      | "offscreen-unavailable-after-create"
      | undefined;
    let lifecycleCategory: ClipboardFallbackLifecycleCategory | undefined;

    const hasDocument = async (): Promise<boolean> => {
      try {
        return (await dependencies.offscreen.hasDocument()) === true;
      } catch {
        return false;
      }
    };

    try {
      let available = await hasDocument();
      if (!available) {
        try {
          await dependencies.offscreen.createDocument();
          createdDocument = true;
          // Chrome resolves createDocument after the initial page load. A
          // single confirmation is enough; polling here would add an
          // unbounded lifecycle dependency without making the write safer.
          available = await hasDocument();
          if (!available) {
            creationFailureCategory = "offscreen-unavailable-after-create";
          }
        } catch {
          // Another extension event may have created the same document between
          // the check and create call. Confirm before reporting failure.
          available = await hasDocument();
          if (available) {
            lifecycleCategory = "offscreen-create-race";
          } else {
            creationFailureCategory = "offscreen-not-created";
          }
        }
      }
      if (!available) {
        // No write is attempted when the static document cannot be confirmed.
      } else {
        let response: ClipboardWriteResponse;
        try {
          response = await dependencies.offscreen.writeText({
            type: CLIPBOARD_WRITE_MESSAGE,
            requestId: request.requestId,
            text: request.prompt,
          });
        } catch {
          // A rejected runtime.sendMessage has no response to inspect.
          failureCategory = "response-failed";
          response = { ok: false, reason: "response-failed" };
        }
        if (isClipboardWriteResponse(response)) {
          if (response.ok) {
            status = "copied";
          } else {
            failureCategory = response.reason;
          }
        } else {
          failureCategory = "response-failed";
        }
      }
    } catch {
      // hasDocument failures are intentionally collapsed to a lifecycle
      // category; the thrown value may contain browser or page details.
      failureCategory ??= "offscreen-not-created";
    } finally {
      if (createdDocument) {
        try {
          await dependencies.offscreen.closeDocument();
        } catch {
          // Closing is best effort. The prompt is never retried because the
          // write operation above has already reached a terminal state.
          cleanupFailureCategory = "close-failed";
        }
      }
    }

    const category =
      failureCategory ?? creationFailureCategory ?? cleanupFailureCategory;
    const bannerShown = await showBanner(
      dependencies.banner,
      request.tabId,
      bannerKindFor(status, request.cause),
    );
    return {
      status,
      bannerShown,
      ...(category ? { reason: category, failureCategory: category } : {}),
      ...(cleanupFailureCategory ? { cleanupFailureCategory } : {}),
      ...(lifecycleCategory ? { lifecycleCategory } : {}),
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
