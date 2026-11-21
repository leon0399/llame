/**
 * The UI parts of one streamed reply and the sequence each one opened at
 * (text/streaming design D3, reasoning parts D8): the identities the AG-UI
 * stream names, and the candidates a `model.superseded` window removes.
 *
 * A wire can reuse one adapter id for several parts (a reasoning → tool →
 * reasoning step under a constant id), so the UI id is llame-owned and counted
 * per kind, and a boundary is decided by two DEFINED adapter ids that differ —
 * an absent id is "no information" and never one.
 */

/** The two model-output kinds a reply interleaves. */
export type StreamPartKind = 'text' | 'reasoning';

export class StreamPartTracker {
  private readonly counts: Record<StreamPartKind, number> = {
    text: 0,
    reasoning: 0,
  };
  private readonly openIds = new Map<StreamPartKind, string>();
  private readonly adapterIds = new Map<StreamPartKind, string | undefined>();
  // Where each part of the current step opened. Only `model.completed` ends the
  // step: a later step's windows start after every sequence they can see.
  private readonly openedAt = new Map<string, number>();

  /** The open UI part of `kind`, or undefined when that kind is closed. */
  open(kind: StreamPartKind): string | undefined {
    return this.openIds.get(kind);
  }

  /**
   * Whether this delivery of `kind` continues the open part: a part of that
   * kind is open and its adapter id is absent, or both ids are the same.
   */
  continues(kind: StreamPartKind, partId: string | undefined): boolean {
    if (!this.openIds.has(kind)) return false;
    const openPartId = this.adapterIds.get(kind);

    return (
      partId === undefined || openPartId === undefined || partId === openPartId
    );
  }

  /** Closes the open part of `kind`, reporting the UI id it had. */
  close(kind: StreamPartKind): string | undefined {
    const openId = this.openIds.get(kind);

    if (openId === undefined) return undefined;
    this.openIds.delete(kind);
    this.adapterIds.delete(kind);

    return openId;
  }

  /** Opens the next UI part of `kind` at this delivery's sequence. */
  begin(
    kind: StreamPartKind,
    partId: string | undefined,
    sequence: number | undefined,
  ): string {
    this.counts[kind] += 1;
    const id = `${kind}-${this.counts[kind]}`;

    this.openIds.set(kind, id);
    this.adapterIds.set(kind, partId);

    if (sequence !== undefined && Number.isInteger(sequence) && sequence > 0) {
      this.openedAt.set(id, sequence);
    }

    return id;
  }

  /** A defined id becomes the open part's id; an absent one adds nothing. */
  adopt(kind: StreamPartKind, partId: string | undefined): void {
    if (partId !== undefined) this.adapterIds.set(kind, partId);
  }

  /**
   * The parts a window from `from` (inclusive) to `to` (exclusive) opened,
   * removed from tracking: nothing a kept step opened can be superseded later.
   */
  takeWindow(from: number, to: number): Array<string> {
    const windowed: Array<string> = [];

    for (const [partId, sequence] of this.openedAt) {
      if (sequence < from || sequence >= to) continue;
      windowed.push(partId);
      this.openedAt.delete(partId);
    }

    return windowed;
  }

  /** A step ended: its parts are committed, so no later window can name them. */
  clear(): void {
    this.openedAt.clear();
  }
}
