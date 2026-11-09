import { Injectable } from '@nestjs/common';

/** The runs worker's view: register a run's controller, unregister it on settle (#268). */
export type RunAbortRegistrar = Pick<
  RunAbortRegistry,
  'register' | 'unregister'
>;

/** The executor's view: one controller per model call of a segment. */
export type RunSegmentRegistrar = Pick<
  RunAbortRegistry,
  'beginSegment' | 'endSegment'
>;

/**
 * AbortController reason of an owner interrupt (run-steering D7). The executor
 * reads it to tell a stop that settles the step from a cancellation, which
 * aborts the Run controller with no reason or with a timeout reason.
 */
export const INTERRUPT_ABORT_REASON = 'owner-interrupt';

type SegmentEntry = { controller: AbortController; attemptId: string };

/**
 * Registry of the in-flight runs this process executes (#48).
 *
 * The worker registers an AbortController per executing run, with the run's
 * owner so a later control message is confirmed in that owner's tenant scope.
 * Nothing aborts a controller directly from a request: every cancel path
 * records the cancellation and sends it on the `llame_run_control` channel, and
 * the control listener of the executing process calls abort() — one path for
 * every topology (design D6).
 *
 * The executing attempt also registers one segment controller per model call,
 * with the attempt id of its segment. An interrupt aborts only that
 * controller, and only while the Run still executes that attempt.
 */
@Injectable()
export class RunAbortRegistry {
  private readonly entries = new Map<
    string,
    { controller: AbortController; userId: string; segment?: SegmentEntry }
  >();

  register(runId: string, userId: string): AbortController {
    const controller = new AbortController();
    this.entries.set(runId, { controller, userId });
    return controller;
  }

  unregister(runId: string): void {
    this.entries.delete(runId);
  }

  /** The owner of a run executing in this process. */
  ownerOf(runId: string): string | undefined {
    return this.entries.get(runId)?.userId;
  }

  /** Every run executing in this process, with its owner. */
  executing(): Array<{ runId: string; userId: string }> {
    return [...this.entries].map(([runId, { userId }]) => ({ runId, userId }));
  }

  /** Abort an in-flight run if it executes in this process. */
  abort(runId: string): void {
    this.entries.get(runId)?.controller.abort();
  }

  /**
   * Opens the segment controller of a model call that `attemptId` runs. It
   * replaces the call before it: a call that follows a withdrawn interrupt
   * starts from a fresh signal. Undefined when this process does not execute
   * the Run.
   */
  beginSegment(runId: string, attemptId: string): AbortController | undefined {
    const entry = this.entries.get(runId);
    if (!entry) return undefined;
    const controller = new AbortController();
    entry.segment = { controller, attemptId };
    return controller;
  }

  /** Closes the call's controller, unless a later call already replaced it. */
  endSegment(runId: string, controller: AbortController): void {
    const entry = this.entries.get(runId);
    if (entry?.segment?.controller === controller) entry.segment = undefined;
  }

  /** The attempt whose model call or tool calls are in flight, if any. */
  segmentAttemptOf(runId: string): string | undefined {
    return this.entries.get(runId)?.segment?.attemptId;
  }

  /**
   * Stops the in-flight model call and tool calls of the Run's segment run by
   * `attemptId`. Returns whether that segment was in flight to stop.
   */
  interrupt(runId: string, attemptId: string): boolean {
    const segment = this.entries.get(runId)?.segment;
    if (
      !segment ||
      segment.attemptId !== attemptId ||
      segment.controller.signal.aborted
    ) {
      return false;
    }
    segment.controller.abort(INTERRUPT_ABORT_REASON);
    return true;
  }
}
