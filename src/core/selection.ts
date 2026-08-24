/** Prompt と一時保存量を制限する selection の上限（UTF-16 code units）。 */
export const MAX_SELECTION_LENGTH = 8_000;

export type SelectionNormalizationFailure = "not-string" | "empty" | "too-long";

export type SelectionNormalizationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: SelectionNormalizationFailure };

/** 改行を LF に揃え、前後の空白を除去した selection を返す。 */
export function normalizeSelection(value: unknown): string | null {
  const result = normalizeSelectionDetailed(value);
  return result.ok ? result.value : null;
}

export function normalizeSelectionDetailed(
  value: unknown,
): SelectionNormalizationResult {
  if (typeof value !== "string") {
    return { ok: false, reason: "not-string" };
  }

  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (normalized.length > MAX_SELECTION_LENGTH) {
    return { ok: false, reason: "too-long" };
  }

  return { ok: true, value: normalized };
}
