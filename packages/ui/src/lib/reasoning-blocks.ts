/**
 * Boundary repair for providers that stream reasoning as discrete summary
 * parts (OpenAI Responses `reasoningSummary`, and relays of that wire). Each
 * completed part opens with a bold markdown heading, but a wire that drops the
 * summary index — or history persisted before part ids were recorded —
 * concatenates them, gluing a heading onto the text before it: `**One****Two**`
 * is a `****` run markdown reads as neither a bold close nor a bold open.
 *
 * Display and export only: a persisted part holds the exact text the provider
 * produced (a signed or encrypted block is replayed byte-identically), so the
 * repair runs where the text is rendered or exported, never on the stored
 * part. Idempotent: already-separated text is left alone.
 */

// A heading butting straight onto the previous part, in the two shapes the
// wire produces:
//   1. heading-onto-heading — `**One****Two**`, a `****` run between heading text.
//   2. prose-onto-heading   — `interaction!**Two**` at the end of a line.
// Emphasis that legitimately follows whitespace (`the **signature** field`) or
// punctuation (`Check (**signature**) next`) is left alone, and a heading must
// close at a line end to count as a summary part.
const GLUED_HEADING_RUN = /(?<=[^\s*])\*{4}(?=[^\s*])/g;
const GLUED_AFTER_PROSE = /(?<=[^\s*])(\*\*(?=[^\s*])[^\n]*?\*\*)(?=\n|$)/g;

export function separateGluedReasoningBlocks(text: string): string {
  return text
    .replace(GLUED_HEADING_RUN, "**\n\n**")
    .replace(GLUED_AFTER_PROSE, "\n\n$1");
}
