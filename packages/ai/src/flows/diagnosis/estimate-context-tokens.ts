const ASCII_TOKEN_WEIGHT = 0.25;
const CJK_TOKEN_WEIGHT = 1.5;
const OTHER_TOKEN_WEIGHT = 1;

function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  );
}

/** CJK/ASCII weighted token estimate. Does not tokenize or call host APIs. */
export function estimateWeightedTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) tokens += ASCII_TOKEN_WEIGHT;
    else if (isCjkCodePoint(code)) tokens += CJK_TOKEN_WEIGHT;
    else tokens += OTHER_TOKEN_WEIGHT;
  }
  return Math.ceil(tokens);
}
