/**
 * `trim` only removes whitespace, so a string made of zero-width or other invisible formatting
 * characters survives a non-blank check and then reaches the user as nothing at all — a caption that
 * burns in blank, or a reason that explains nothing. Anything carrying no visible glyph counts as
 * empty here, before it is written down, rather than at render time when the user cannot act on it.
 */
export function hasVisibleText(value: string): boolean {
  return value.replace(/[\p{Cf}\p{Cc}\p{Zs}\p{Zl}\p{Zp}\s]/gu, "").length > 0;
}

/**
 * A stricter gate for fields whose whole job is to explain something to the user: why a clip cannot
 * be used, why a list came back empty. `。。。` and `...` pass `hasVisibleText` and then reach the
 * user as an explanation that explains nothing, which is the same failure as a blank one.
 *
 * Requires two characters that carry meaning — a letter, a digit or a CJK ideograph — rather than a
 * length, because two Chinese characters can be a real answer ("太暗") while ten dots cannot.
 */
export function hasReadableText(value: string): boolean {
  return (value.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;
}
