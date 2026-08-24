/** X/Twitter の URL として許可するホスト。恒久的な host permission とは別の検証境界。 */
export const ALLOWED_X_HOSTS = Object.freeze([
  "x.com",
  "twitter.com",
  "www.x.com",
  "www.twitter.com",
] as const);

export type AllowedXHost = (typeof ALLOWED_X_HOSTS)[number];
export type XUrlKind = "status" | "page";

export interface NormalizedXUrl {
  readonly value: string;
  readonly host: AllowedXHost;
  readonly kind: XUrlKind;
}

const allowedHosts = new Set<string>(ALLOWED_X_HOSTS);

function isAllowedHost(hostname: string): hostname is AllowedXHost {
  return allowedHosts.has(hostname);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x20 || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function encodePathSegment(rawSegment: string): string | null {
  let decodedSegment: string;
  try {
    decodedSegment = decodeURIComponent(rawSegment);
  } catch {
    return null;
  }

  // A decoded slash/backslash could change the path structure. Dot segments and
  // control characters are also rejected instead of being interpreted later.
  if (
    decodedSegment.length === 0 ||
    decodedSegment === "." ||
    decodedSegment === ".." ||
    decodedSegment.includes("/") ||
    decodedSegment.includes("\\") ||
    containsControlCharacter(decodedSegment)
  ) {
    return null;
  }

  return encodeURIComponent(decodedSegment);
}

interface NormalizedPath {
  readonly encodedSegments: readonly string[];
  readonly decodedSegments: readonly string[];
}

function normalizePath(pathname: string): NormalizedPath | null {
  if (!pathname.startsWith("/")) {
    return null;
  }

  // A trailing slash does not identify a different X resource. Internal empty
  // segments are retained as invalid instead of being silently collapsed.
  const pathWithoutTrailingSlash = pathname.replace(/\/+$/u, "") || "/";
  if (pathWithoutTrailingSlash === "/") {
    return { encodedSegments: [], decodedSegments: [] };
  }

  const encodedSegments: string[] = [];
  const decodedSegments: string[] = [];
  for (const rawSegment of pathWithoutTrailingSlash.slice(1).split("/")) {
    const encodedSegment = encodePathSegment(rawSegment);
    if (encodedSegment === null) {
      return null;
    }

    let decodedSegment: string;
    try {
      decodedSegment = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    encodedSegments.push(encodedSegment);
    decodedSegments.push(decodedSegment);
  }

  return { encodedSegments, decodedSegments };
}

function normalizeInput(rawUrl: string): URL | null {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return null;
  }

  const trimmedUrl = rawUrl.trim();
  // Spaces/control characters in a URL are ambiguous input. Encoded spaces
  // remain valid and do not match this check.
  if (containsControlCharacter(trimmedUrl)) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return null;
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username.length > 0 ||
    parsedUrl.password.length > 0 ||
    (parsedUrl.port !== "" && parsedUrl.port !== "443") ||
    !isAllowedHost(parsedUrl.hostname.toLowerCase())
  ) {
    return null;
  }

  return parsedUrl;
}

/**
 * X/Twitter URL を canonical URL にする。
 *
 * status URL は `/<user>/status/<id>` へ縮約し、それ以外の X ページは
 * current-page fallback として path の query/hash だけを除去する。
 */
export function normalizeXUrl(rawUrl: string): NormalizedXUrl | null {
  const parsedUrl = normalizeInput(rawUrl);
  if (parsedUrl === null) {
    return null;
  }

  const host = parsedUrl.hostname.toLowerCase();
  if (!isAllowedHost(host)) {
    return null;
  }

  const normalizedPath = normalizePath(parsedUrl.pathname);
  if (normalizedPath === null) {
    return null;
  }

  const { encodedSegments, decodedSegments } = normalizedPath;
  const hasStatusMarker =
    decodedSegments.length >= 2 && decodedSegments[1] === "status";

  if (hasStatusMarker) {
    const statusId = decodedSegments[2];
    if (statusId === undefined || !/^\d+$/u.test(statusId)) {
      return null;
    }

    const user = encodedSegments[0];
    const encodedStatusId = encodedSegments[2];
    if (user === undefined || encodedStatusId === undefined) {
      return null;
    }

    return {
      value: `${parsedUrl.origin}/${user}/status/${encodedStatusId}`,
      host,
      kind: "status",
    };
  }

  const normalizedPathValue =
    encodedSegments.length === 0 ? "/" : `/${encodedSegments.join("/")}`;
  return {
    value: `${parsedUrl.origin}${normalizedPathValue}`,
    host,
    kind: "page",
  };
}

/** 正規化に成功した canonical X/Twitter URL だけを返す簡易 API。 */
export function sanitizeXUrl(rawUrl: string): string | null {
  return normalizeXUrl(rawUrl)?.value ?? null;
}

export function isAllowedXUrl(rawUrl: string): boolean {
  return normalizeXUrl(rawUrl) !== null;
}
