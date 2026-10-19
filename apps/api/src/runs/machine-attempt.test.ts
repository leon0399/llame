import {
  MACHINE_PREPARATION_BUDGET_MS,
  machineAttemptKey,
  machineEnvelope,
} from './machine-attempt';

describe('machineAttemptKey', () => {
  it('keys one Run and one delivery sequence apart', () => {
    expect(machineAttemptKey('run-1', 4)).toBe('run-1\u00004');
    expect(machineAttemptKey('run-1', 4)).not.toBe(
      machineAttemptKey('run-1', 5),
    );
    expect(machineAttemptKey('run-1', 4)).not.toBe(
      machineAttemptKey('run-14', undefined),
    );
  });

  it('names an absent delivery sequence instead of losing the Run id', () => {
    // A Run with no delivery sequence must still key apart from the same Run
    // at sequence 0: `none` is a name, not a missing piece of the key.
    expect(machineAttemptKey('run-1', undefined)).toBe('run-1\u0000none');
    expect(machineAttemptKey('run-1', undefined)).not.toBe(
      machineAttemptKey('run-1', 0),
    );
  });
});

describe('machineEnvelope', () => {
  it('carries every identity it is given, under the protocol names', () => {
    expect(
      machineEnvelope({
        runId: 'run-1',
        attemptId: 'attempt-1',
        toolCallId: 'tool-1',
        deliverySequence: 7,
      }),
    ).toEqual({
      runId: 'run-1',
      attemptId: 'attempt-1',
      toolCallId: 'tool-1',
      deliverySeq: 7,
      budgetMs: MACHINE_PREPARATION_BUDGET_MS,
    });
  });

  it('leaves absent identities absent', () => {
    const envelope = machineEnvelope({ runId: 'run-1' });
    expect(envelope).toEqual({
      runId: 'run-1',
      budgetMs: MACHINE_PREPARATION_BUDGET_MS,
    });
    expect(Object.keys(envelope).sort()).toEqual(['budgetMs', 'runId']);
  });

  it('carries a caller budget when one is named and the preparation bound otherwise', () => {
    expect(machineEnvelope({ budgetMs: 250 }).budgetMs).toBe(250);
    const envelope = machineEnvelope({});
    expect(envelope.budgetMs).toBe(MACHINE_PREPARATION_BUDGET_MS);
    expect(Object.keys(envelope)).toEqual(['budgetMs']);
  });
});
