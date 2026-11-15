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

/**
 * The control of one model call. `abort` stops the call and its `cancel` tool
 * calls (an owner interrupt). `yield` asks a call that can continue as a job to
 * return; it is not an abort, and it stays raised until the call ends.
 */
export type SegmentControl = {
  readonly abort: AbortController;
  readonly yield: AbortController;
};

export function newSegmentControl(): SegmentControl {
  return { abort: new AbortController(), yield: new AbortController() };
}

export type SegmentSnapshot = Readonly<{
  control: SegmentControl;
  attemptId: string;
}>;

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
    { controller: AbortController; userId: string; segment?: SegmentSnapshot }
  >();

  register(runId: string, userId: string): AbortController {
    const controller = new AbortController();
    this.entries.set(runId, { controller, userId });

    return controller;
  }

  unregister(runId: string, controller: AbortController): void {
    if (this.entries.get(runId)?.controller === controller) {
      this.entries.delete(runId);
    }
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
  beginSegment(runId: string, attemptId: string): SegmentControl | undefined {
    const entry = this.entries.get(runId);

    if (!entry) return undefined;
    const control = newSegmentControl();
    entry.segment = { control, attemptId };

    return control;
  }

  /** Closes the call's control, unless a later call already replaced it. */
  endSegment(runId: string, control: SegmentControl): void {
    const entry = this.entries.get(runId);

    if (entry?.segment?.control === control) entry.segment = undefined;
  }

  /** The current model-call segment, including its exact registry identity. */
  segmentOf(runId: string): SegmentSnapshot | undefined {
    return this.entries.get(runId)?.segment;
  }

  /**
   * Stops the captured segment if it is still current. Returns whether that
   * exact segment was in flight to stop.
   */
  interrupt(runId: string, segment: SegmentSnapshot): boolean {
    if (
      this.entries.get(runId)?.segment !== segment ||
      segment.control.abort.signal.aborted
    ) {
      return false;
    }

    // The yield comes first, so a call that continues as a job returns before
    // the interrupt settlement waits for it.
    segment.control.yield.abort();
    segment.control.abort.abort(INTERRUPT_ABORT_REASON);

    return true;
  }

  /**
   * Raises the yield signal of the captured segment if it is still current.
   * It never aborts the call.
   */
  yield(runId: string, segment: SegmentSnapshot): boolean {
    if (this.entries.get(runId)?.segment !== segment) return false;
    segment.control.yield.abort();

    return true;
  }
}
