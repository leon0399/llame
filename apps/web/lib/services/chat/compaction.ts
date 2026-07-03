import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { chatQueryKeys } from "./queries";

/**
 * The chat's latest compaction (#57) — the boundary where older turns were
 * folded into a summary for the model's context. Read-only; owner-scoped by the
 * api. Surfaced so the user understands the model's view of a long chat.
 */
export type Compaction = {
  uptoSeq: number;
  summary: string;
  createdAt: string;
};

export async function fetchCompaction(
  chatId: string,
): Promise<Compaction | null> {
  return api
    .get(buildApiUrl(`/api/v1/chats/${chatId}/compaction`))
    .json<Compaction | null>();
}

export function useChatCompactionQuery(chatId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...chatQueryKeys.detail(chatId), "compaction"] as const,
    queryFn: () => fetchCompaction(chatId),
    enabled: enabled && chatId.length > 0,
    staleTime: 30_000,
  });
}

/**
 * Index in `messages` where the compacted span ENDS — i.e. where the marker
 * renders (BEFORE that index; `=== messages.length` renders AFTER the last).
 * The boundary is the first message past `uptoSeq` (`metadata.seq > uptoSeq`, or
 * a live/seq-less message, which is always newest).
 *
 * Sentinel `-1` = no marker, and ONLY for "no compaction" or "no messages".
 * When a compaction exists but EVERY loaded message is within the summarized
 * span (all `seq <= uptoSeq` — the most-invisible case the feature exists to
 * surface), the boundary is AFTER them (`messages.length`), so the marker still
 * shows. Index `0` → the whole loaded window is post-boundary → marker at the
 * top ("earlier messages summarized" above, older ones not yet loaded).
 *
 * Computed over the CURRENTLY-LOADED window (today the full history — no
 * client-side pagination yet).
 */
export function compactionBoundaryIndex(
  messages: ReadonlyArray<{ metadata?: { seq?: number } }>,
  uptoSeq: number | null | undefined,
): number {
  if (uptoSeq === null || uptoSeq === undefined || messages.length === 0) {
    return -1;
  }
  const idx = messages.findIndex((m) => {
    const seq = m.metadata?.seq;
    return seq === undefined || seq > uptoSeq;
  });
  return idx === -1 ? messages.length : idx;
}
