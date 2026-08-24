/** Optional permissions requested after the one-time preview is accepted. */
export const OPTIONAL_PERMISSION_BUNDLE: chrome.permissions.Permissions = {
  permissions: ["offscreen", "clipboardWrite"],
  origins: ["https://chatgpt.com/*"],
};
