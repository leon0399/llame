import { Injectable } from '@nestjs/common';

/** The runs worker's view: register a run's controller, unregister it on settle (#268). */
export type RunAbortRegistrar = Pick<
  RunAbortRegistry,
  'register' | 'unregister'
>;

/**
 * Registry of the in-flight runs this process executes (#48).
 *
 * The worker registers an AbortController per executing run, with the run's
 * owner so a later control message is confirmed in that owner's tenant scope.
 * Nothing aborts a controller directly from a request: every cancel path
 * records the cancellation and sends it on the `llame_run_control` channel, and
 * the control listener of the executing process calls abort() — one path for
 * every topology (design D6).
 */
@Injectable()
export class RunAbortRegistry {
  private readonly entries = new Map<
    string,
    { controller: AbortController; userId: string }
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

  /** Abort an in-flight run if it executes in this process. Returns whether it did. */
  abort(runId: string): boolean {
    const entry = this.entries.get(runId);
    if (!entry) {
      return false;
    }
    entry.controller.abort();
    return true;
  }
}
