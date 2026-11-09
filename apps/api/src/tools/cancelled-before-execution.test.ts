import {
  cancelledBeforeExecution,
  isCancelledBeforeExecution,
} from './cancelled-before-execution';

describe('cancelledBeforeExecution', () => {
  it('is recognised for the same tool id', () => {
    expect(
      isCancelledBeforeExecution(cancelledBeforeExecution('bash'), 'bash'),
    ).toBe(true);
  });

  it('is not recognised for another tool id', () => {
    expect(
      isCancelledBeforeExecution(cancelledBeforeExecution('bash'), 'read'),
    ).toBe(false);
  });

  it('is not recognised when the result is not an error', () => {
    expect(
      isCancelledBeforeExecution({ status: 'success', output: 'x' }, 'bash'),
    ).toBe(false);
  });

  it('is not recognised when the error type differs but the message matches', () => {
    expect(
      isCancelledBeforeExecution(
        {
          status: 'error',
          type: 'outcome_unknown',
          message: 'Tool "bash" was cancelled.',
        },
        'bash',
      ),
    ).toBe(false);
  });

  it('is not recognised when the type is cancelled but the message differs', () => {
    expect(
      isCancelledBeforeExecution(
        { status: 'error', type: 'cancelled', message: 'stopped' },
        'bash',
      ),
    ).toBe(false);
  });
});
