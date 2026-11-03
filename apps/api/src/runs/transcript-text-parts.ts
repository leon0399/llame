/**
 * Text part boundaries for the assistant transcript (design A7). Kept apart
 * from `assistant-transcript.ts` so the collector itself stays within the
 * repository's file-size limit; the rules are the reasoning part's rules, with
 * the deliberate asymmetry design A7 records.
 */
import { isString } from '@workspace/runtime-safety';
import type { ProviderMetadata } from 'ai';

import type { MessagePart } from '../chats/context-builder';

/** A call the collector reserved but has not settled yet. */
type PendingToolPart = { readonly type: 'pending-tool'; toolCallId: string };

/** Every part the transcript holds, in order. */
type Transcript = Array<MessagePart | PendingToolPart>;

/**
 * Records text deliveries onto the transcript, deciding part boundaries and
 * binding a part's opaque provider metadata to it.
 *
 * - A delivery with text starts or extends a part; a new part starts on two
 *   defined adapter ids that differ, so two Responses `message` items stay two
 *   stored parts and a wire without ids keeps one merged part.
 * - An empty delivery carrying metadata starts nothing: it binds to the part
 *   its id already names, or waits for that id to produce text. An empty text
 *   part would add separators to `partsToText` and nothing the model can use.
 */
export class TextPartTrack {
  // Adapter part id of the open text part (undefined = the wire gave none).
  private openPartId: string | undefined;
  // Index of every text part, by adapter part id, so metadata that arrives
  // after its part (a Responses item's end) still reaches the right part.
  private readonly partIndexes = new Map<string, number>();
  // Text metadata a part's start delivered before its first character.
  private readonly pendingMetadata = new Map<string, ProviderMetadata>();

  record(
    collected: Transcript,
    text: string,
    partId?: string,
    providerMetadata?: ProviderMetadata,
  ): void {
    if (text.length > 0) {
      if (!this.extend(collected, text, partId, providerMetadata)) {
        this.start(collected, text, partId, providerMetadata);
      }
      return;
    }
    // The part's start (or a repeat of its end): bind to the part its id
    // names, or hold the metadata until that id produces text.
    const index =
      partId === undefined
        ? this.openPartIndex(collected)
        : this.partIndexes.get(partId);
    if (index !== undefined) {
      this.bind(collected, partId, providerMetadata, index);
      return;
    }
    if (partId !== undefined && providerMetadata !== undefined) {
      this.pendingMetadata.set(partId, providerMetadata);
    }
  }

  /** Extends the open text part, or reports that a new part must start. */
  private extend(
    collected: Transcript,
    text: string,
    partId: string | undefined,
    providerMetadata: ProviderMetadata | undefined,
  ): boolean {
    const last = collected.at(-1);
    if (
      last?.type !== 'text' ||
      !isString(last.text) ||
      this.isNewPart(partId)
    ) {
      return false;
    }
    last.text += text;
    // A defined id becomes the open part's id; an absent id adds nothing.
    this.openPartId = partId ?? this.openPartId;
    this.bind(collected, partId, providerMetadata, collected.length - 1);
    return true;
  }

  /** Starts a text part and binds whatever metadata its delivery carried. */
  private start(
    collected: Transcript,
    text: string,
    partId: string | undefined,
    providerMetadata: ProviderMetadata | undefined,
  ): void {
    this.openPartId = partId;
    const part: MessagePart = { type: 'text', text };
    collected.push(part);
    this.bind(collected, partId, providerMetadata, collected.length - 1);
  }

  /**
   * Records the metadata a text part's delivery carried on the part at
   * `index`, and adopts whatever its start delivered first. An absent value
   * leaves the stored one alone, so a start's item id survives the deltas that
   * follow it.
   */
  private bind(
    collected: Transcript,
    partId: string | undefined,
    providerMetadata: ProviderMetadata | undefined,
    index: number,
  ): void {
    const pending =
      partId === undefined ? undefined : this.pendingMetadata.get(partId);
    const metadata = providerMetadata ?? pending;
    if (partId !== undefined) {
      this.partIndexes.set(partId, index);
      if (pending !== undefined) this.pendingMetadata.delete(partId);
    }
    if (metadata === undefined) return;
    const part = collected[index];
    if (part?.type === 'text' && isString(part.text)) {
      part.providerMetadata = metadata;
    }
  }

  /** Index of the open text part, when the last collected part is one. */
  private openPartIndex(collected: Transcript): number | undefined {
    const last = collected.at(-1);
    return last?.type === 'text' && isString(last.text)
      ? collected.length - 1
      : undefined;
  }

  /**
   * A new persisted text part starts on two defined ids that differ. An
   * undefined id is "no information" — it neither opens nor closes a part.
   */
  private isNewPart(partId?: string): boolean {
    return (
      partId !== undefined &&
      this.openPartId !== undefined &&
      partId !== this.openPartId
    );
  }
}
