const TRAILING_PUNCTUATION = /[.,;:]+$/g;

export function normalizeNameForStorage(value: string) {
  const collapsedWhitespace = value.replace(/\s+/g, " ").trim();
  if (!collapsedWhitespace) {
    return "";
  }
  const withoutTrailingPunctuation = collapsedWhitespace.replace(TRAILING_PUNCTUATION, "").trim();
  return withoutTrailingPunctuation.replace(/\s+/g, " ").trim();
}

export function normalizeNameForComparison(value: string) {
  return normalizeNameForStorage(value).toLocaleLowerCase();
}

export function namesMatchNormalized(a: string, b: string) {
  return normalizeNameForComparison(a) === normalizeNameForComparison(b);
}
