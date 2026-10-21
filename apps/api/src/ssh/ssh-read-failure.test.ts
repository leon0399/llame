import { type SshRunOutcome } from './ssh-client';
import {
  classifySshBashOutcome,
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
    stderrOverflow: false,
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

  it('classifies a key-exchange or mid-connect drop as unreachable', () => {
    // A peer that hangs up before the handshake finishes reports a key-exchange
    // failure or a closed connection, not `connect ... closed by`, and it is
    // still a connection failure rather than a host that ran no llame script.
    expect(
      classifySshPreludeFailure(
        ended(
          'kex_exchange_identification: Connection closed by remote host',
          255,
        ),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'unreachable' });
    expect(
      classifySshPreludeFailure(
        ended('Connection closed by 10.0.0.5 port 22', 255),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'unreachable' });
    expect(
      classifySshPreludeFailure(
        ended(
          'kex_exchange_identification: No SSH version received in first 1024 lines from server\nbanner exchange: Connection to 10.0.0.5 port 22: invalid format',
          255,
        ),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'unreachable' });
    expect(
      classifySshPreludeFailure(
        ended(
          'banner exchange: Connection to 10.0.0.5 port 22: invalid format',
          255,
        ),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'unreachable' });
  });

  it('does not take the debug handshake banner for a connection failure', () => {
    // An included configuration can raise LogLevel, and every handshake then
    // prints this banner; the forced command that follows ran no llame script.
    expect(
      classifySshPreludeFailure(
        ended(
          'debug1: kex_exchange_identification: banner line 0: SSH-2.0-OpenSSH_9.6',
          0,
        ),
      ),
    ).toEqual({ kind: 'unsupported', cause: 'no_script' });
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

  it('names bash itself when only bash is missing', () => {
    expect(
      classifySshPreludeFailure(ended('sh: 1: bash: not found', 127)),
    ).toEqual({ kind: 'unsupported', cause: 'bash' });
    expect(
      classifySshPreludeFailure(
        ended('bash: line 1: bash: command not found', 127),
      ),
    ).toEqual({ kind: 'unsupported', cause: 'bash' });
    expect(
      classifySshPreludeFailure(ended('zsh:1: command not found: bash', 127)),
    ).toEqual({ kind: 'unsupported', cause: 'bash' });
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

describe('classifySshBashOutcome', () => {
  it('is complete only with the end trailer', () => {
    expect(
      classifySshBashOutcome(ended(''), {
        started: true,
        stdout: Buffer.alloc(0),
        stderr: '',
        status: 0,
      }),
    ).toEqual({ kind: 'complete' });
  });

  it('leaves a command without its trailer an unknown outcome', () => {
    const frames = { started: true, stdout: Buffer.alloc(0), stderr: '' };
    expect(classifySshBashOutcome(ended(''), frames)).toEqual({
      kind: 'unknown',
    });
    expect(classifySshBashOutcome(failed('timed_out'), frames)).toEqual({
      kind: 'unknown',
    });
    expect(classifySshBashOutcome(failed('cancelled'), frames)).toEqual({
      kind: 'unknown',
    });
  });

  it('leaves a pre-marker bash cancellation unknown and keeps a refusal typed', () => {
    const unstarted = { started: false, stdout: Buffer.alloc(0), stderr: '' };
    // The local ssh may have sent the script before the hub stopped it.
    expect(classifySshBashOutcome(failed('cancelled'), unstarted)).toEqual({
      kind: 'unknown',
    });
    expect(
      classifySshBashOutcome(
        ended('ssh: connect to host box port 22: Connection refused', 255),
        unstarted,
      ),
    ).toEqual({ kind: 'unavailable', reason: 'unreachable' });
    // A login shell that floods stdout can push the marker past the bound.
    expect(
      classifySshBashOutcome(
        { ...ended('', 0), stdoutOverflow: true },
        unstarted,
      ),
    ).toEqual({ kind: 'unknown' });
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
