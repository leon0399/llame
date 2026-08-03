/**
 * Per-field caps for owner-authored personalization (design D6).
 *
 * Hosted products cap near 1,500–2,000 characters because they pay for the
 * tokens; self-hosting inverts that incentive, so these are deliberately
 * generous. Two llame-specific bounds are still real and are why a cap exists
 * at all: snapshot rows store the full prompt text per distinct version, and
 * the system prompt consumes context window against a compaction threshold of
 * `contextWindowTokens × COMPACTION_WINDOW_RATIO`.
 *
 * Worst case is roughly 16.3k characters — call it 4k tokens — on every request
 * for that owner. Against a large window that is noise. Against a small local
 * model (an 8k window compacts at 6.4k) a maxed-out profile is a serious
 * fraction of the budget. That is the owner's own doing and is documented
 * rather than prevented.
 *
 * Enforced at the DTO, not in the column type, so changing a cap is not a
 * migration — same treatment as the 20000-char bound on message content.
 */
export const PERSONALIZATION_CAPS = {
  preferredName: 255,
  about: 8000,
  responsePreferences: 8000,
} as const;
