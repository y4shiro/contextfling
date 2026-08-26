/** Optional permissions requested after the one-time preview is accepted. */
export const OPTIONAL_PERMISSION_BUNDLE: chrome.permissions.Permissions = {
  permissions: ["offscreen", "clipboardWrite"],
  origins: ["https://chatgpt.com/*"],
};

const OPTIONAL_PERMISSION_COMPONENTS: chrome.permissions.Permissions[] = [
  { permissions: ["offscreen"] },
  { permissions: ["clipboardWrite"] },
  { origins: ["https://chatgpt.com/*"] },
];

export interface OptionalPermissionPort {
  contains(permissions: chrome.permissions.Permissions): Promise<boolean>;
  remove(permissions: chrome.permissions.Permissions): Promise<boolean>;
}

export async function hasOptionalPermissionBundle(
  permissions: OptionalPermissionPort,
): Promise<boolean> {
  try {
    return await permissions.contains(OPTIONAL_PERMISSION_BUNDLE);
  } catch {
    return false;
  }
}

/**
 * Remove the optional bundle and verify every component independently.
 * A rejected verification is treated as permission still being present so the
 * caller cannot report a successful revocation without evidence.
 */
export async function revokeOptionalPermissionBundle(
  permissions: OptionalPermissionPort,
): Promise<boolean> {
  try {
    await permissions.remove(OPTIONAL_PERMISSION_BUNDLE);
  } catch {
    // Verification below remains authoritative, including already-absent state.
  }

  const remaining = await Promise.all(
    OPTIONAL_PERMISSION_COMPONENTS.map(async (component) => {
      try {
        return await permissions.contains(component);
      } catch {
        return true;
      }
    }),
  );
  return remaining.every((present) => !present);
}
