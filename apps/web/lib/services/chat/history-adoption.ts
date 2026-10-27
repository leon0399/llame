/**
 * Applying a freshly fetched history to the live log (the client half of #261):
 * the live list is what the reader sees, so a server read may only heal what it
 * provably covers. Split out of `history.ts` when the two concerns together
 * outgrew that module's line budget.
 */

import type { UIMessage } from "ai";

import { messageSeqFromMetadata, runIdFromMessageMetadata } from "./history";

/**
 * The oldest and newest durable seq in a message list, in one pass — null
 * when the list holds no durable row at all. Returning the pair together
 * lets the type system carry "at least one seq'd message exists" through
 * adoptServerHistory, instead of two scans with individually-nullable
 * results that are in fact null together.
 */
function durableSeqBounds(
  messages: ReadonlyArray<UIMessage>,
): { oldest: number; newest: number } | null {
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const message of messages) {
    const seq = messageSeqFromMetadata(message.metadata);
    if (seq === null) continue;
    oldest ??= seq;
    newest = seq;
  }
  return oldest !== null && newest !== null ? { oldest, newest } : null;
}

/**
 * The index of every durable row a live stream already supersedes: a turn's
 * reply must never sit beside the stream that replaces it (turn-actions D13),
 * whichever path put the old copy back — a history read that raced the
 * follow-up's start reintroduces the reply the client had already dropped, and
 * the stream then attaches after it. A live-authored reply carries no durable
 * seq, so every durable assistant row between its turn's user message and it is
 * the replaced copy. Shared with the transcript's render-time rule.
 */
export function supersededReplyIndexes(
  messages: ReadonlyArray<UIMessage>,
): Set<number> {
  const superseded = new Set<number>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    if (messageSeqFromMetadata(message.metadata) !== null) continue;
    let turnStart = index - 1;
    while (turnStart >= 0 && messages[turnStart]?.role !== "user") turnStart--;
    for (let row = turnStart + 1; row < index; row += 1) {
      if (messages[row]?.role === "assistant") superseded.add(row);
    }
  }
  return superseded;
}

/** The messages without the rows a live stream supersedes. */
function withoutSupersededRows(
  messages: ReadonlyArray<UIMessage>,
): ReadonlyArray<UIMessage> {
  const superseded = supersededReplyIndexes(messages);
  return superseded.size === 0
    ? messages
    : messages.filter((_message, index) => !superseded.has(index));
}

/** The live streamed reply of each turn, keyed by its user message id. A live
 *  reply carries no durable seq, and its id is the Run that produced it. */
function streamedReplyByTurn(
  liveMessages: ReadonlyArray<UIMessage>,
): ReadonlyMap<string, UIMessage> {
  const replies = new Map<string, UIMessage>();
  for (let index = 0; index < liveMessages.length; index += 1) {
    const message = liveMessages[index];
    if (message?.role !== "assistant") continue;
    if (messageSeqFromMetadata(message.metadata) !== null) continue;
    const user = liveMessages[index - 1];
    if (user?.role === "user") replies.set(user.id, message);
  }
  return replies;
}

/**
 * The server rows without the reply copies a live stream has already
 * superseded. A follow-up Run replaces the turn's reply in place, and the
 * client drops the old reply as soon as it starts the follow-up — so a history
 * read that lands before the new reply is finalized still lists the reply it
 * replaced. Adopting that row would show the replaced answer beside the
 * stream (and leave it there), so a durable reply only counts as the streamed
 * turn's own when its `usage.runId` is that streamed message's id; anything
 * else under the same user turn is the stale copy, and the live reply stands
 * until a later read carries the finalized row.
 */
function withoutSupersededReplies(
  serverMessages: ReadonlyArray<UIMessage>,
  liveMessages: ReadonlyArray<UIMessage>,
): ReadonlyArray<UIMessage> {
  const streamed = streamedReplyByTurn(liveMessages);
  if (streamed.size === 0) return serverMessages;
  return serverMessages.filter((message, index) => {
    if (message.role !== "assistant") return true;
    const user = serverMessages[index - 1];
    if (user?.role !== "user") return true;
    const live = streamed.get(user.id);
    if (live === undefined) return true;
    return runIdFromMessageMetadata(message.metadata) === live.id;
  });
}

/**
 * The healed message list a freshly fetched server history justifies, or
 * null when the live list should stand. `useChat` freezes its messages at
 * creation, so a refetch is the ONLY thing that can heal a log the durable
 * run has moved past (#261) — and it can only heal it through `setMessages`.
 *
 * The not-streaming guard is the one with teeth: mid-turn the live copy
 * legitimately runs ahead of the server (an optimistic user turn, an answer
 * still streaming), and replacing it there duplicates or rewinds the
 * transcript (#259).
 *
 * Settled, the adoption rule is a durable-coverage comparison: adopt when
 * the server list extends past the log's durable rows on EITHER end.
 *
 * - NEWER coverage: the server's newest seq is beyond the newest durable seq
 *   the log holds. Live-authored messages never carry a seq, so every
 *   settled state worth healing lands here — a strictly longer history
 *   (204-resume, #261), a disconnect that left a partial answer at equal
 *   length, and a completed turn whose final assistant must swap its
 *   streaming representation (Run id as message id) for the durable one
 *   (Message id + Run id in metadata, which the fork affordance and context
 *   inspector need).
 * - OLDER coverage: an on-demand older page (#187) grew the window at the
 *   head without touching the newest seq.
 *
 * Adoption stamps every message with its durable seq, so re-running
 * afterwards is a no-op.
 *
 * The server history is a WINDOW (#187): the pages the reader has loaded,
 * not necessarily the whole chat. Live messages older than the window's
 * coverage (they exist exactly when the reader loaded older pages that a
 * later slid-window refetch no longer spans) are durable rows already
 * adopted once — keep them, and replace only the covered tail. The split is
 * on strict `seq < server oldest`, so the overlap region dedupes to the
 * server copy.
 */
export function adoptServerHistory(input: {
  status: string;
  serverMessages: ReadonlyArray<UIMessage>;
  liveMessages: ReadonlyArray<UIMessage>;
}): Array<UIMessage> | null {
  if (input.status === "streaming" || input.status === "submitted") {
    return null;
  }
  const live = withoutSupersededRows(input.liveMessages);
  const server = withoutSupersededReplies(
    input.serverMessages,
    input.liveMessages,
  );
  const serverBounds = durableSeqBounds(server);
  if (serverBounds === null) return null;
  const liveBounds = durableSeqBounds(live);

  const extendsNewer =
    liveBounds === null || serverBounds.newest > liveBounds.newest;
  const extendsOlder =
    liveBounds !== null && serverBounds.oldest < liveBounds.oldest;
  if (!extendsNewer && !extendsOlder) return null;

  const head = liveHead(live, serverBounds.oldest);
  const tail = liveTail(live, server);
  const healed = [...head, ...server, ...tail];
  // Adoption writes the live log, so it must be idempotent: re-adopting a list
  // the log already holds would set state on every pass and, once the
  // superseded-row rules make a read alternate between two shapes, loop until
  // React aborts the render. Same messages by reference in the same order means
  // there is nothing to adopt.
  const alreadyLive =
    healed.length === input.liveMessages.length &&
    healed.every((message, index) => message === input.liveMessages[index]);
  return alreadyLive ? null : healed;
}

/** The live messages older than the server window's coverage: durable rows the
 *  reader loaded before a slid-window refetch stopped spanning them. */
function liveHead(
  liveMessages: ReadonlyArray<UIMessage>,
  oldestServerSeq: number,
): Array<UIMessage> {
  const head: Array<UIMessage> = [];
  for (const message of liveMessages) {
    const seq = messageSeqFromMetadata(message.metadata);
    if (seq === null || seq >= oldestServerSeq) break;
    head.push(message);
  }
  return head;
}

/**
 * The trailing live-authored messages this server read does NOT carry. Adoption
 * must not clip the log's live end: a refetch can land while the tail is only
 * PARTIALLY durable — the user turn commits synchronously at send, the
 * assistant reply only at run termination, so a mid-stream disconnect refetch
 * advances the newest seq (the user turn) while the reader's partial answer
 * exists nowhere server-side. Wiping it blanks text the reader is looking at
 * until the background poll re-adopts, which on a long run is minutes. So keep
 * each trailing live-authored message unless THIS server read provably carries
 * its durable copy: a user turn persists under the client-supplied message id
 * (idempotent create), and a streamed assistant's live id is its Run id, which
 * the durable row carries in usage metadata. Matching per message (not "server
 * advanced ⇒ tail covered") is what keeps a kept message from ever duplicating
 * a server row.
 */
function liveTail(
  liveMessages: ReadonlyArray<UIMessage>,
  server: ReadonlyArray<UIMessage>,
): Array<UIMessage> {
  const serverIds = new Set(server.map((message) => message.id));
  const serverRunIds = new Set(
    server.flatMap((message) => {
      const runId = runIdFromMessageMetadata(message.metadata);
      return runId === null ? [] : [runId];
    }),
  );
  const tail: Array<UIMessage> = [];
  for (let index = liveMessages.length - 1; index >= 0; index--) {
    const message = liveMessages[index];
    if (messageSeqFromMetadata(message.metadata) !== null) break;
    if (serverIds.has(message.id) || serverRunIds.has(message.id)) continue;
    tail.unshift(message);
  }
  return tail;
}
