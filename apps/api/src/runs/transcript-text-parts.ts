/**
 * Text part boundaries for the assistant transcript (design A7): the
 * reasoning part's rules, with the asymmetry that a text part never starts
 * empty.
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

  /**
   * Records a text delivery and reports the metadata it stored on a part, if
   * any: the value this delivery carried, or a part start's value adopted by
   * the delivery that first wrote its text. The run persists metadata only
   * when this reports a binding, so metadata that names no stored part never
   * reaches the event log.
   */
  record(
    collected: Transcript,
    text: string,
    partId?: string,
    providerMetadata?: ProviderMetadata,
  ): ProviderMetadata | undefined {
    if (text.length > 0) {
      const last = collected.at(-1);
      if (
        last?.type !== 'text' ||
        !isString(last.text) ||
        this.isNewPart(partId)
      ) {
        this.openPartId = partId;
        collected.push({ type: 'text', text });
      } else {
        last.text += text;
        // A defined id becomes the open part's id; an absent id adds nothing.
        this.openPartId = partId ?? this.openPartId;
      }
      return this.bind(
        collected,
        partId,
        providerMetadata,
        collected.length - 1,
      );
    }
    // The part's start (or a repeat of its end): bind to the part its id
    // names, or hold the metadata until that id produces text.
    const index =
      partId === undefined
        ? this.openPartIndex(collected)
        : this.partIndexes.get(partId);
    if (index !== undefined) {
      return this.bind(collected, partId, providerMetadata, index);
    }
    if (partId !== undefined && providerMetadata !== undefined) {
      this.pendingMetadata.set(partId, providerMetadata);
    }
    return undefined;
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
  ): ProviderMetadata | undefined {
    const pending =
      partId === undefined ? undefined : this.pendingMetadata.get(partId);
    const metadata = providerMetadata ?? pending;
    if (partId !== undefined) {
      this.partIndexes.set(partId, index);
      if (pending !== undefined) this.pendingMetadata.delete(partId);
    }
    if (metadata === undefined) return undefined;
    const part = collected[index];
    if (part?.type !== 'text' || !isString(part.text)) return undefined;
    part.providerMetadata = metadata;
    return metadata;
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
