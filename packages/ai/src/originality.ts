/** Consecutive characters that count as lifted rather than merely similar. */
export const VERBATIM_RUN_CHARACTERS = 12;

function normalized(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[^\p{Letter}\p{Number}]/gu, "");
}

/**
 * True when the candidate copy repeats a long enough run of the reference to read as the original
 * author's sentence rather than the user's own. Punctuation and case are stripped first, so
 * re-punctuating a lifted line does not get past it.
 *
 * Shared by the plan and the blueprint: both write copy from the same reference, and one rule kept
 * in two places would let whichever check is looser decide what ships.
 */
export function sharesVerbatimRun(candidate: string, reference: string, runLength = VERBATIM_RUN_CHARACTERS): boolean {
  const source = normalized(reference);
  const written = normalized(candidate);
  if (source.length < runLength || written.length < runLength) return false;
  for (let index = 0; index <= written.length - runLength; index += 1) {
    if (source.includes(written.slice(index, index + runLength))) return true;
  }
  return false;
}
