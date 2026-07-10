export type PromptSummary = { id: string; name: string; content: string };

/**
 * The prompt menu for the current composer input, or null (no menu).
 *
 * Triggers ONLY when the whole input is a lone `/<slug>` token with at least
 * one char (`^/(\S+)$`) — so bare `/` never auto-opens (a literal "/" message
 * still sends), a message that merely contains a slash ("what is /etc/hosts",
 * has spaces) never triggers, and a multiline paste never triggers. Filters by
 * case-insensitive name PREFIX; returns null when nothing matches, so `/xyz`
 * with no match doesn't block sending literal text.
 */
export function matchingPrompts(
  input: string,
  prompts: readonly PromptSummary[],
): PromptSummary[] | null {
  const match = /^\/(\S+)$/.exec(input);
  if (!match) return null;
  const query = match[1].toLowerCase();
  const found = prompts.filter((p) =>
    p.name.toLowerCase().startsWith(query),
  );
  return found.length > 0 ? found : null;
}
