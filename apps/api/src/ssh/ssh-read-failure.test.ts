import { type SshRunOutcome } from './ssh-client';
import {
  classifySshPreludeFailure,
  classifySshReadOutcome,
} from './ssh-read-failure';
import { type SshReadFrames } from './ssh-script';

const STARTED: SshReadFrames = {
  started: true,
  kind: 'file',
  content: Buffer.from('x'),
  status: 0,
};

const REFUSED: SshReadFrames = {
  started: false,
  content: Buffer.alloc(0),
  refusal: 'not_found',
};

function ended(diagnostic: string, code: number | null = 0): SshRunOutcome {
  return {
    outcome: 'ended',
    stdout: Buffer.alloc(0),
    stdoutOverflow: false,
    diagnostic,
    code,
    signal: null,
  };
}

function failed(
  reason: 'client_missing' | 'timed_out' | 'cancelled',
): SshRunOutcome {
  return { outcome: 'failed', reason, diagnostic: '' };
}

describe('classifySshPreludeFailure', () => {
  it('names a spawn failure as the missing client', () => {
    expect(classifySshPreludeFailure(failed('client_missing'))).toEqual({
      kind: 'unavailable',
      reason: 'client_missing',
    });
  });

  it('treats our own deadline before the marker as an unreachable host', () => {
    expect(classifySshPreludeFailure(failed('timed_out'))).toEqual({
      kind: 'unavailable',
      reason: 'unreachable',
    });
  });

  it('reports cancellation as itself', () => {
    expect(classifySshPreludeFailure(failed('cancelled'))).toEqual({
      kind: 'cancelled',
    });
  });

  it('classifies ssh own refusals', () => {
    expect(
      classifySshPreludeFailure(ended('Host key verification failed.', 255)),
    ).toEqual({ kind: 'unavailable', reason: 'host_key_mismatch' });
    expect(
      classifySshPreludeFailure(
        ended('box: Permission denied (publickey).', 255),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'auth_failed' });
    expect(
      classifySshPreludeFailure(
        ended('ssh: connect to host box port 22: Connection refused', 255),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'unreachable' });
  });

  it('does not take remote text for an authentication failure', () => {
    // A forced command that prints the words is not ssh refusing a credential.
    expect(
      classifySshPreludeFailure(ended('permission denied by remote policy', 0)),
    ).toEqual({ kind: 'unsupported', cause: 'no_script' });
  });

  it('names the missing POSIX shell when the login shell reports it', () => {
    expect(
      classifySshPreludeFailure(
        ended('bash: line 1: sh: command not found', 127),
      ),
    ).toEqual({ kind: 'unsupported', cause: 'posix_shell' });
  });

  it('needs the missing-shell exit status, not just the phrase', () => {
    // A remote command that merely prints the words is a host that ran no
    // llame script, not one whose interpreter is missing.
    expect(
      classifySshPreludeFailure(
        ended('bash: line 1: sh: command not found', 1),
      ),
    ).toEqual({ kind: 'unsupported', cause: 'no_script' });
  });

  it('names the POSIX shell requirement for a Windows login shell', () => {
    expect(
      classifySshPreludeFailure(
        ended(
          "'sh' is not recognized as an internal or external command,\r\noperable program or batch file.",
          1,
        ),
      ),
    ).toEqual({ kind: 'unsupported', cause: 'posix_shell' });
    expect(
      classifySshPreludeFailure(
        ended(
          "sh : The term 'sh' is not recognized as the name of a cmdlet.",
          1,
        ),
      ),
    ).toEqual({ kind: 'unsupported', cause: 'posix_shell' });
  });

  it('reports a forced command or nologin as running no llame script', () => {
    expect(classifySshPreludeFailure(ended('', 0))).toEqual({
      kind: 'unsupported',
      cause: 'no_script',
    });
    expect(
      classifySshPreludeFailure(
        ended('This account is currently not available.', 1),
      ),
    ).toEqual({ kind: 'unsupported', cause: 'no_script' });
  });
});

describe('classifySshReadOutcome', () => {
  it('is complete only with the start marker and the end trailer', () => {
    expect(classifySshReadOutcome(ended(''), STARTED)).toEqual({
      kind: 'complete',
    });
  });

  it('reports a start marker without its trailer as a lost session', () => {
    expect(
      classifySshReadOutcome(ended(''), {
        started: true,
        content: Buffer.from('x'),
      }),
    ).toEqual({ kind: 'unavailable', reason: 'session_lost' });
  });

  it('reports a deadline after the marker as a lost session', () => {
    expect(
      classifySshReadOutcome(failed('timed_out'), {
        started: true,
        content: Buffer.alloc(0),
      }),
    ).toEqual({ kind: 'unavailable', reason: 'session_lost' });
  });

  it('keeps a cancellation after the marker a cancellation', () => {
    expect(
      classifySshReadOutcome(failed('cancelled'), {
        started: true,
        content: Buffer.alloc(0),
      }),
    ).toEqual({ kind: 'cancelled' });
  });

  it('classifies a pre-marker end from ssh stderr', () => {
    expect(classifySshReadOutcome(ended('', 0), REFUSED)).toEqual({
      kind: 'unsupported',
      cause: 'no_script',
    });
  });
});
