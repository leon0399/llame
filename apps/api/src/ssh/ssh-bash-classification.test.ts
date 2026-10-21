/**
 * What a remote `bash` call's process and frames amount to. The verdict is the
 * seam between ssh's own refusal (before the marker) and a command whose end
 * the hub cannot attribute (after it, without the trailer).
 */
import { type SshRunOutcome } from './ssh-client';
import { classifySshBashOutcome } from './ssh-read-failure';
import { type SshBashFrames } from './ssh-script';

function ended(diagnostic: string, code: number): SshRunOutcome {
  return {
    outcome: 'ended',
    stdout: Buffer.alloc(0),
    stdoutOverflow: false,
    diagnostic,
    stderrOverflow: false,
    code,
    signal: null,
  };
}

const STARTED: SshBashFrames = {
  started: true,
  stdout: Buffer.alloc(0),
  stderr: '',
  status: 0,
};

const NOT_STARTED: SshBashFrames = {
  started: false,
  stdout: Buffer.alloc(0),
  stderr: '',
};

describe('classifySshBashOutcome', () => {
  it('is unknown when a started command ended without its end trailer', () => {
    expect(
      classifySshBashOutcome(
        { outcome: 'failed', reason: 'timed_out', diagnostic: '' },
        STARTED,
      ),
    ).toEqual({ kind: 'unknown' });
  });

  it.each([['cancelled' as const], ['timed_out' as const]])(
    'is unknown when the local ssh was stopped (%s) before the marker arrived',
    (reason) => {
      // The script may have reached the host before the hub stopped its ssh,
      // so the command may have run; only the trailer could have said so.
      expect(
        classifySshBashOutcome(
          { outcome: 'failed', reason, diagnostic: '' },
          NOT_STARTED,
        ),
      ).toEqual({ kind: 'unknown' });
    },
  );

  it('keeps a missing client a known refusal before the marker', () => {
    expect(
      classifySshBashOutcome(
        { outcome: 'failed', reason: 'client_missing', diagnostic: '' },
        NOT_STARTED,
      ),
    ).toEqual({ kind: 'unavailable', reason: 'client_missing' });
  });

  it('lets a process that ended before the marker report its own refusal', () => {
    expect(
      classifySshBashOutcome(
        ended('box: Permission denied (publickey).', 255),
        NOT_STARTED,
      ),
    ).toEqual({ kind: 'unavailable', reason: 'auth_failed' });
  });

  it('treats a missing interpreter only as a missing one at status 127', () => {
    // A host that exits 1 saying the command is missing ran a shell, so it is
    // not the `bash: not found` a POSIX shell reports at 127.
    expect(
      classifySshBashOutcome(ended('bash: command not found', 1), NOT_STARTED),
    ).toEqual({ kind: 'unsupported', cause: 'no_script' });
    expect(
      classifySshBashOutcome(
        ended('bash: command not found', 127),
        NOT_STARTED,
      ),
    ).toEqual({ kind: 'unsupported', cause: 'bash' });
  });
});
