import { X_SELECTORS } from "./selectors.js";

export interface StatusLinkCandidate {
  readonly href: string;
  readonly distance: number;
  readonly documentOrder: number;
}

function looksLikeStatusUrl(rawHref: string, baseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawHref, baseUrl);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    !new Set(["x.com", "twitter.com", "www.x.com", "www.twitter.com"]).has(
      parsed.hostname.toLowerCase(),
    )
  ) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    segments.length < 3 ||
    segments[1] !== "status" ||
    !/^\d+$/u.test(segments[2] ?? "")
  ) {
    return null;
  }
  return parsed.href;
}

/** 距離→DOM 順で候補を一つ選ぶ純粋 helper。 */
export function chooseNearestStatusLink(
  candidates: readonly StatusLinkCandidate[],
): string | null {
  let selected: StatusLinkCandidate | undefined;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.distance) || candidate.distance < 0) {
      continue;
    }
    if (
      !Number.isInteger(candidate.documentOrder) ||
      candidate.documentOrder < 0
    ) {
      continue;
    }
    if (
      selected === undefined ||
      candidate.distance < selected.distance ||
      (candidate.distance === selected.distance &&
        candidate.documentOrder < selected.documentOrder)
    ) {
      selected = candidate;
    }
  }
  return selected?.href ?? null;
}

function ancestorDistance(anchorNode: Node | null, candidate: Element): number {
  if (anchorNode === null) {
    return Number.POSITIVE_INFINITY;
  }

  const anchorAncestors = new Map<Node, number>();
  let current: Node | null = anchorNode;
  let anchorDistance = 0;
  while (current !== null) {
    anchorAncestors.set(current, anchorDistance);
    current = current.parentNode;
    anchorDistance += 1;
  }

  current = candidate;
  let candidateDistance = 0;
  while (current !== null) {
    const distanceFromAnchor = anchorAncestors.get(current);
    if (distanceFromAnchor !== undefined) {
      return distanceFromAnchor + candidateDistance;
    }
    current = current.parentNode;
    candidateDistance += 1;
  }

  return Number.POSITIVE_INFINITY;
}

function selectionElement(selection: Selection | null): Element | null {
  const node = selection?.anchorNode ?? null;
  if (node === null) {
    return null;
  }
  if (node.nodeType === 1) {
    return node as Element;
  }
  return node.parentElement;
}

/**
 * 実 DOM を純粋に読む X extractor。DOM を変更せず、href 候補だけを返す。
 * 呼び出し側は返値を必ず core/url の normalizer に通す。
 */
export function extractNearestStatusHref(
  _document: Document,
  selection: Selection | null,
  pageUrl: string,
): string | null {
  const selectedElement = selectionElement(selection);
  const article = selectedElement?.closest(X_SELECTORS.article) ?? null;
  if (article === null) {
    return null;
  }

  const candidates: StatusLinkCandidate[] = [];
  const links = article.querySelectorAll<HTMLAnchorElement>(
    X_SELECTORS.statusLink,
  );
  links.forEach((link, documentOrder) => {
    const rawHref = link.getAttribute("href") ?? link.href;
    const href = looksLikeStatusUrl(rawHref, pageUrl);
    if (href === null) {
      return;
    }
    candidates.push({
      href,
      distance: ancestorDistance(selection?.anchorNode ?? null, link),
      documentOrder,
    });
  });

  return chooseNearestStatusLink(candidates);
}

/**
 * chrome.scripting.executeScript({ func: extractNearestStatusUrl }) 用の自己完結関数。
 * ここでは外部 module の値を参照しない（Chrome は function の closure を持ち込まない）。
 */
export function extractNearestStatusUrl(): string | null {
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode ?? null;
  const selectedElement =
    anchorNode === null
      ? null
      : anchorNode.nodeType === 1
        ? (anchorNode as Element)
        : anchorNode.parentElement;
  const article = selectedElement?.closest("article") ?? null;
  if (article === null) {
    return null;
  }

  const allowedHosts = new Set([
    "x.com",
    "twitter.com",
    "www.x.com",
    "www.twitter.com",
  ]);
  const anchorAncestors = new Map<Node, number>();
  let ancestor: Node | null = anchorNode;
  let anchorDistance = 0;
  while (ancestor !== null) {
    anchorAncestors.set(ancestor, anchorDistance);
    ancestor = ancestor.parentNode;
    anchorDistance += 1;
  }

  const links = article.querySelectorAll("a[href]");
  let best: { href: string; distance: number; order: number } | undefined;
  links.forEach((link, order) => {
    const rawHref =
      link.getAttribute("href") ?? (link as HTMLAnchorElement).href;
    let parsed: URL;
    try {
      parsed = new URL(rawHref, location.href);
    } catch {
      return;
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (
      parsed.protocol !== "https:" ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      !allowedHosts.has(parsed.hostname.toLowerCase()) ||
      segments.length < 3 ||
      segments[1] !== "status" ||
      !/^\d+$/u.test(segments[2] ?? "")
    ) {
      return;
    }

    let linkAncestor: Node | null = link;
    let linkDistance = 0;
    let distance = Number.POSITIVE_INFINITY;
    while (linkAncestor !== null) {
      const fromAnchor = anchorAncestors.get(linkAncestor);
      if (fromAnchor !== undefined) {
        distance = fromAnchor + linkDistance;
        break;
      }
      linkAncestor = linkAncestor.parentNode;
      linkDistance += 1;
    }

    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && order < best.order)
    ) {
      best = { href: parsed.href, distance, order };
    }
  });

  return best?.href ?? null;
}
