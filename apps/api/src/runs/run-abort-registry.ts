import { Injectable } from '@nestjs/common';

/**
 * In-process abort registry for in-flight runs (#48).
 *
 * The fast path for cancellation while the API and worker share a process:
 * the worker registers an AbortController per executing run; the cancel
 * endpoint aborts it directly. The durable source of truth is always
 * runs.cancel_requested_at — when the worker moves to its own process, this
 * registry's abort() simply stops finding entries and the worker honors the
 * DB flag instead (at pickup; mid-flight via LISTEN/NOTIFY later).
 */
/** The runs worker's view: register a run's controller, unregister it on settle (#268). */
export type RunAbortRegistrar = Pick<
  RunAbortRegistry,
  'register' | 'unregister'
>;

/** The chat send path's view: abort a superseded run by id (#268). */
export type RunAborter = Pick<RunAbortRegistry, 'abort'>;

@Injectable()
export class RunAbortRegistry {
  private readonly controllers = new Map<string, AbortController>();

  register(runId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  unregister(runId: string): void {
    this.controllers.delete(runId);
  }

  /** Abort an in-flight run if it executes in this process. Returns whether it did. */
  abort(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }
}
