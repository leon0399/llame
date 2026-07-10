/**
 * Prompt templating — `{{placeholder}}` variables in a saved prompt body.
 * A fresh RegExp per call (no shared `lastIndex` state); the class `[^{}]*?`
 * between the literals has no overlapping quantifiers, so no ReDoS.
 */
const pattern = () => /\{\{([^{}]*?)\}\}/g;

/** The UNIQUE placeholder names in first-seen order (trimmed; `{{}}`/`{{ }}` ignored). */
export function extractPlaceholders(content: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(pattern())) {
    const name = match[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/**
 * Replace every `{{name}}` with `values[name]` in a SINGLE pass — so a filled
 * value that itself contains `{{...}}` is NOT re-expanded (no loop/injection).
 * Unfilled/missing → empty string; `{{}}`/`{{ }}` (no name) is left literal.
 */
export function fillPlaceholders(
  content: string,
  values: Record<string, string>,
): string {
  return content.replace(pattern(), (whole, raw: string) => {
    const name = raw.trim();
    if (!name) return whole;
    return values[name] ?? "";
  });
}
