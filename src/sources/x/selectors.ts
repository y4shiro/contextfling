/** X DOM の selector はこの module に集約する。 */
export const X_SELECTORS = Object.freeze({
  article: "article",
  statusLink: "a[href]",
} as const);

export type XSelectorName = keyof typeof X_SELECTORS;
