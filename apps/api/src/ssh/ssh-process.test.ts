import { classifySshLinkFailure } from './ssh-process';

describe('classifySshLinkFailure', () => {
  it('reads ssh own refusal messages before the handshake', () => {
    expect(classifySshLinkFailure(false, 'Host key verification failed.')).toBe(
      'host_key_mismatch',
    );
    expect(
      classifySshLinkFailure(false, 'me@box: Permission denied (publickey).'),
    ).toBe('auth_failed');
    expect(
      classifySshLinkFailure(
        false,
        'ssh: connect to host box port 22: Connection timed out',
      ),
    ).toBe('unreachable');
    expect(
      classifySshLinkFailure(false, 'llame-machine: command not found'),
    ).toBe('unreachable');
    expect(classifySshLinkFailure(false, '')).toBe('unreachable');
  });

  it('reads an end after the handshake as a lost session', () => {
    expect(classifySshLinkFailure(true, 'Host key verification failed.')).toBe(
      'session_lost',
    );
    expect(
      classifySshLinkFailure(
        true,
        'kex_exchange_identification: read: Connection reset by peer',
      ),
    ).toBe('session_lost');
  });
});
