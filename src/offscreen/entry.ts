import {
  type ClipboardWriter,
  installClipboardMessageHandler,
  type RuntimeMessagePort,
} from "./clipboard.js";

/** Install the static offscreen document's runtime message handler. */
export function installOffscreenClipboardHandler(): void {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime ||
    typeof document === "undefined"
  ) {
    return;
  }
  const clipboard: ClipboardWriter | undefined = document.body
    ? (document as unknown as ClipboardWriter)
    : undefined;
  installClipboardMessageHandler(
    chrome.runtime as unknown as RuntimeMessagePort,
    clipboard,
  );
}

if (typeof chrome !== "undefined") {
  installOffscreenClipboardHandler();
}
