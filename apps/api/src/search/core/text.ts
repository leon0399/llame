import { createHash } from 'node:crypto';

/**
 * Deterministic normalization applied to every searchable chunk before it is
 * stored in `normalized_content` (the FTS + trigram match column) — corpus-
 * agnostic (chat search now; knowledge/RAG and curated memory later).
 *
 * - Unicode NFKC so compatibility variants (full-width, ligatures) match.
 * - Whitespace/newlines collapsed to single spaces so chunk-join artifacts don't
 *   create phantom tokens.
 * - Lowercased for case-insensitive matching (#171). `toLowerCase()` PRESERVES
 *   accents (é stays é) — we deliberately do NOT strip diacritics or transliterate,
 *   which would merge distinct words and wreck non-English (ru/es) recall.
 * - Code, identifiers, and URLs are preserved as-is (only cased/whitespace-folded).
 */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Content hash for a chunk: lets the reindex worker skip unchanged chunks (no-op
 * upsert) and, in phase 2, guards a stale embedding against newer content. Bound
 * to the chunker version and the covered message range as well as the text, so a
 * chunker-algorithm change or a shifted message window is a hash change even when
 * the serialized text happens to collide. `\u0000` is a safe runtime field
 * separator (it cannot appear in normalized chat text), represented as a source
 * escape so this TypeScript file remains valid text.
 */
export function chunkContentHash(input: {
  chunkerVersion: number;
  content: string;
  normalizedContent: string;
  firstMessageId: string;
  lastMessageId: string;
  firstMessageTextOffset: number;
  lastMessageTextOffsetExclusive: number;
}): string {
  return createHash('sha256')
    .update(
      [
        String(input.chunkerVersion),
        input.content,
        input.normalizedContent,
        input.firstMessageId,
        input.lastMessageId,
        String(input.firstMessageTextOffset),
        String(input.lastMessageTextOffsetExclusive),
      ].join('\u0000'),
    )
    .digest('hex');
}
