/**
 * `trim` only removes whitespace, so a string made of zero-width or other invisible formatting
 * characters survives a non-blank check and then reaches the user as nothing at all — a caption that
 * burns in blank, or a reason that explains nothing. Anything carrying no visible glyph counts as
 * empty here, before it is written down, rather than at render time when the user cannot act on it.
 */
export function hasVisibleText(value: string): boolean {
  return value.replace(/[\p{Cf}\p{Cc}\p{Zs}\p{Zl}\p{Zp}\s]/gu, "").length > 0;
}
