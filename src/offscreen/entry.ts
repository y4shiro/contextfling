import {
  type ClipboardWriter,
  installClipboardMessageHandler,
  type RuntimeMessagePort,
} from "./clipboard.js";

/** Install the static offscreen document's runtime message handler. */
export function installOffscreenClipboardHandler(): void {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return;
  }
  const clipboard: ClipboardWriter | undefined =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;
  installClipboardMessageHandler(
    chrome.runtime as unknown as RuntimeMessagePort,
    clipboard,
  );
}

if (typeof chrome !== "undefined") {
  installOffscreenClipboardHandler();
}
