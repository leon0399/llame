/**
 * Boundary repair for providers that stream reasoning as discrete summary
 * parts (OpenAI gpt-5.x / Responses `reasoningSummary`, and relays of that
 * wire). Each completed part opens with a bold markdown heading, but the
 * chat-completions surface drops `summary_index`, so concatenated deltas
 * glue into `**One****Two**` — a `****` run markdown reads as neither a
 * bold close nor a bold open.
 *
 * Port of Hermes Agent's display repair (NousResearch/hermes-agent#80736),
 * which itself matches vercel/ai#6742. Idempotent: already-separated text
 * is left alone.
 */

// A heading butting straight onto the previous part, in the two shapes the
// wire produces:
//   1. heading-onto-heading — `**One****Two**`, a `****` run between heading text.
//   2. prose-onto-heading   — `interaction!**Two**`.
// Emphasis that legitimately follows whitespace is left alone, and a heading
// must close on its own line to count as a summary part.
const GLUED_HEADING_RUN = /(?<=[^\s*])\*{4}(?=[^\s*])/g;
const GLUED_AFTER_PROSE = /(?<=[^\s*])(\*\*(?=[^\s*])[^\n]*?\*\*)(?=\n|$)/g;

export function separateGluedReasoningBlocks(text: string): string {
  return text
    .replace(GLUED_HEADING_RUN, "**\n\n**")
    .replace(GLUED_AFTER_PROSE, "\n\n$1");
}
