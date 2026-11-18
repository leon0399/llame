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

// A summary heading: a line that is one bold run and nothing else. Bold text
// inside a sentence, or two runs on a line, is the model's own emphasis.
const HEADING_LINE = /^\s*\*\*([^*\n]+)\*\*\s*$/;

/**
 * The latest summary heading in reasoning text: what the model is thinking
 * about now. Only a line that is a single `**bold**` run counts, so a
 * provider that emphasizes words inside its reasoning yields no heading.
 */
export function latestReasoningHeading(text: string): string | undefined {
  let title: string | undefined;
  let fence: string | undefined;

  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];

    if (fence !== undefined) {
      if (
        marker?.[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = undefined;
      }
    } else if (marker !== undefined) {
      fence = marker;
    } else {
      const heading = HEADING_LINE.exec(line)?.[1]?.trim();

      if (heading) title = heading;
    }
  }

  return title;
}
