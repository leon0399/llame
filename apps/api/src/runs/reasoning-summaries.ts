/**
 * Boundary repair for providers that stream reasoning as discrete summary
 * parts. Keep in lockstep with `packages/ui/src/lib/reasoning-blocks.ts` —
 * that copy owns display; this copy owns persistence. See vercel/ai#6742
 * and NousResearch/hermes-agent#80736.
 */
const GLUED_HEADING_RUN = /(?<=[^\s*])\*{4}(?=[^\s*])/g;
const GLUED_AFTER_PROSE = /(?<=[^\s*])(\*\*(?=[^\s*])[^\n]*?\*\*)(?=\n|$)/g;

export function separateGluedReasoningBlocks(text: string): string {
  return text
    .replace(GLUED_HEADING_RUN, '**\n\n**')
    .replace(GLUED_AFTER_PROSE, '\n\n$1');
}
