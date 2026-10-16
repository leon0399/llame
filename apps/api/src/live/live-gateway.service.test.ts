import {
  decideUpgrade,
  LIVE_PATH,
  MAX_SOCKETS_PER_USER,
  type UpgradeDeps,
} from './live-gateway.service';

const allowed = 'http://localhost:3000';

function deps(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps {
  return {
    allowedOrigins: new Set([allowed]),
    validateToken: vi.fn((token: string) =>
      Promise.resolve(
        token === 'good'
          ? { userId: 'user-a', sessionId: 'session-a' }
          : undefined,
      ),
    ),
    openSockets: () => 0,
    ...overrides,
  };
}

const request = (url: string, headers: Record<string, string> = {}) => ({
  url,
  headers,
});

describe('decideUpgrade', () => {
  it('ignores other paths without looking at the session', async () => {
    const d = deps();
    expect(await decideUpgrade(request('/socket.io'), d)).toEqual({
      kind: 'ignore',
    });
    expect(await decideUpgrade({ headers: {} }, d)).toEqual({
      kind: 'ignore',
    });
    expect(d.validateToken).not.toHaveBeenCalled();
  });

  it('accepts the owner of a valid session cookie or bearer token, with a query string', async () => {
    expect(
      await decideUpgrade(
        request(`${LIVE_PATH}?v=1`, {
          cookie: 'llame_session=good',
          origin: allowed,
        }),
        deps(),
      ),
    ).toEqual({ kind: 'accept', userId: 'user-a', token: 'good' });
    expect(
      await decideUpgrade(
        request(LIVE_PATH, { authorization: 'Bearer good' }),
        deps(),
      ),
    ).toEqual({ kind: 'accept', userId: 'user-a', token: 'good' });
  });

  it('refuses a foreign Origin before checking the session', async () => {
    const d = deps();
    expect(
      await decideUpgrade(
        request(LIVE_PATH, {
          cookie: 'llame_session=good',
          origin: 'https://evil.example',
        }),
        d,
      ),
    ).toEqual({ kind: 'reject', status: 403, reason: 'Forbidden' });
    expect(d.validateToken).not.toHaveBeenCalled();
  });

  it.each([
    ['no session', {}],
    ['an invalid session', { cookie: 'llame_session=bad' }],
  ])('refuses %s', async (_label, headers) => {
    expect(await decideUpgrade(request(LIVE_PATH, headers), deps())).toEqual({
      kind: 'reject',
      status: 401,
      reason: 'Unauthorized',
    });
  });

  it('refuses when session validation fails', async () => {
    const d = deps({
      validateToken: vi.fn(() =>
        Promise.reject(new Error('database unavailable')),
      ),
    });
    expect(
      await decideUpgrade(
        request(LIVE_PATH, { authorization: 'Bearer good' }),
        d,
      ),
    ).toMatchObject({ kind: 'reject', status: 401 });
  });

  it('refuses a user at the socket cap and admits one below it', async () => {
    const at = deps({ openSockets: () => MAX_SOCKETS_PER_USER });
    const below = deps({ openSockets: () => MAX_SOCKETS_PER_USER - 1 });
    const headers = { authorization: 'Bearer good' };
    expect(await decideUpgrade(request(LIVE_PATH, headers), at)).toEqual({
      kind: 'reject',
      status: 429,
      reason: 'Too Many Requests',
    });
    expect(
      await decideUpgrade(request(LIVE_PATH, headers), below),
    ).toMatchObject({ kind: 'accept' });
  });
});
