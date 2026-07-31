/**
 * classifyAbortedRun unit tests (durable-run-workers D7): the in-process
 * wall-clock timeout and a user-requested cancel share the exact same
 * AbortController/signal plumbing (RunAbortRegistry) — this is the pure,
 * DB-free mapping that tells them apart so only a timeout is recorded as
 * run.expired, never run.cancelled. Full executeRun coverage (the DB-coupled
 * claim/persist path) lives in the DB-backed integration specs; this pins
 * just the classification the liveness collapse depends on.
 */
import {
  classifyAbortedRun,
  RUN_TIMEOUT_ABORT_REASON,
} from './run-execution.service';

describe('classifyAbortedRun', () => {
  it('classifies an undefined signal as cancelled (no abort occurred / inline caller)', () => {
    expect(classifyAbortedRun(undefined)).toBe('cancelled');
  });

  it('classifies a user cancel (no reason tag) as cancelled', () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyAbortedRun(controller.signal)).toBe('cancelled');
  });

  it('classifies an abort tagged with a reason OTHER than the timeout tag as cancelled', () => {
    const controller = new AbortController();
    controller.abort('some-other-reason');
    expect(classifyAbortedRun(controller.signal)).toBe('cancelled');
  });

  it('classifies the worker in-process wall-clock timeout (RUN_TIMEOUT_ABORT_REASON) as expired', () => {
    const controller = new AbortController();
    controller.abort(RUN_TIMEOUT_ABORT_REASON);
    expect(classifyAbortedRun(controller.signal)).toBe('expired');
  });
});
