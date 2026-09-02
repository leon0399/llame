import type { Response } from 'express';
import {
  AuthController,
  clearSessionCookie,
  setSessionCookie,
} from './auth.controller';
import {
  AuthService,
  type AuthPasswordHasher,
  type AuthSessionStore,
  type AuthUserDirectory,
} from './auth.service';
import { SESSION_COOKIE_NAME } from './constants';
import { SessionTokenService } from './session-token.service';

function responseWithClearCookie(
  clearCookie: Response['clearCookie'],
): Response {
  // SAFETY: these controller methods only call `clearCookie`; the minimal
  // double deliberately omits Express's unrelated response surface.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return { clearCookie } as Response;
}

describe('auth session cookies', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCookieDomain = process.env.SESSION_COOKIE_DOMAIN;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalCookieDomain === undefined) {
      delete process.env.SESSION_COOKIE_DOMAIN;
    } else {
      process.env.SESSION_COOKIE_DOMAIN = originalCookieDomain;
    }
  });

  // Two distinct domains: with a single value, `getSessionCookieDomain` could
  // return that literal instead of reading the env var and every assertion here
  // would still pass.
  it.each(['.example.com', '.other.example.net'])(
    'sets and clears the session cookie with the configured domain %s',
    (configuredDomain) => {
      process.env.SESSION_COOKIE_DOMAIN = configuredDomain;
      const expires = new Date('2030-01-01T00:00:00.000Z');
      const cookie = vi.fn();
      const clearCookie = vi.fn();
      const response: Pick<Response, 'cookie' | 'clearCookie'> = {
        cookie,
        clearCookie,
      };

      setSessionCookie(response, 'raw-session-token', expires);
      clearSessionCookie(response);

      expect(cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        'raw-session-token',
        expect.objectContaining({
          domain: configuredDomain,
          expires,
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
      expect(clearCookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        expect.objectContaining({
          domain: configuredDomain,
          httpOnly: true,
          sameSite: 'lax',
        }),
      );
    },
  );

  it('fails closed in production when the session cookie domain is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_COOKIE_DOMAIN;
    const response: Pick<Response, 'cookie' | 'clearCookie'> = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };

    expect(() =>
      setSessionCookie(response, 'raw-session-token', new Date()),
    ).toThrow(/SESSION_COOKIE_DOMAIN/);
    expect(() => clearSessionCookie(response)).toThrow(/SESSION_COOKIE_DOMAIN/);
  });
});

describe('AuthController forwarding', () => {
  function makeController() {
    const users: AuthUserDirectory = {
      getUserByEmail: vi.fn(),
      getUserById: vi.fn(),
      createUser: vi.fn(),
    };
    const sessions: AuthSessionStore = {
      create: vi.fn(),
      findActiveAndTouch: vi.fn(),
      deleteStaleByTokenHash: vi.fn(),
      deleteByIdForUser: vi.fn(),
      deleteCurrentForUser: vi.fn(),
      deleteOthersForUser: vi.fn(),
      deleteAllForUser: vi.fn(),
      listForUser: vi.fn(),
      findByIdForUser: vi.fn(),
    };
    const password: AuthPasswordHasher = {
      hash: vi.fn(),
      compare: vi.fn(),
    };
    const authService = new AuthService(
      users,
      sessions,
      new SessionTokenService(),
      password,
    );
    const controller = new AuthController(authService);
    return { controller, authService };
  }

  it('forwards current-user and session reads using verified identities', async () => {
    const { controller, authService } = makeController();
    const publicUser = {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@example.com',
      emailVerified: null,
      image: null,
    };
    const sessions = { sessions: [] };
    const current = {
      id: 'session-1',
      userAgent: 'vitest-agent',
      ip: '127.0.0.1',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      lastSeenAt: new Date('2026-08-01T00:00:00.000Z'),
      expires: new Date('2026-09-01T00:00:00.000Z'),
      current: true,
    };
    const getCurrentUser = vi
      .spyOn(authService, 'getCurrentUser')
      .mockResolvedValue(publicUser);
    const listSessions = vi
      .spyOn(authService, 'listSessions')
      .mockResolvedValue(sessions);
    const getCurrentSession = vi
      .spyOn(authService, 'getCurrentSession')
      .mockResolvedValue(current);

    await expect(controller.me('user-1')).resolves.toBe(publicUser);
    await expect(controller.sessions('user-1', 'session-1')).resolves.toBe(
      sessions,
    );
    await expect(
      controller.currentSession('user-1', 'session-1'),
    ).resolves.toBe(current);
    expect(getCurrentUser).toHaveBeenCalledWith('user-1');
    expect(listSessions).toHaveBeenCalledWith('user-1', 'session-1');
    expect(getCurrentSession).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('forwards single-session revoke and clears the cookie for logout', async () => {
    const { controller, authService } = makeController();
    const clearCookie = vi.fn();
    const response = responseWithClearCookie(clearCookie);
    const revokeSession = vi
      .spyOn(authService, 'revokeSession')
      .mockResolvedValue({ revokedCount: 1 });
    const revokeCurrentSession = vi
      .spyOn(authService, 'revokeCurrentSession')
      .mockResolvedValue(1);

    await expect(
      controller.revokeSession('user-1', 'session-2'),
    ).resolves.toEqual({ revokedCount: 1 });
    await expect(
      controller.logout('user-1', 'session-1', response),
    ).resolves.toEqual({ revokedCount: 1 });
    expect(revokeSession).toHaveBeenCalledWith('user-1', 'session-2');
    expect(revokeCurrentSession).toHaveBeenCalledWith('user-1', 'session-1');
    expect(clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('only clears the cookie when revoking all sessions', async () => {
    const { controller, authService } = makeController();
    const clearCookie = vi.fn();
    const response = responseWithClearCookie(clearCookie);
    const revokeSessions = vi
      .spyOn(authService, 'revokeSessions')
      .mockResolvedValue({ revokedCount: 2 });

    await expect(
      controller.revokeSessions('user-1', 'session-1', {}, response),
    ).resolves.toEqual({ revokedCount: 2 });
    expect(revokeSessions).toHaveBeenCalledWith(
      'user-1',
      'session-1',
      'others',
    );
    expect(clearCookie).not.toHaveBeenCalled();

    await expect(
      controller.revokeSessions(
        'user-1',
        'session-1',
        { scope: 'all' },
        response,
      ),
    ).resolves.toEqual({ revokedCount: 2 });
    expect(revokeSessions).toHaveBeenLastCalledWith(
      'user-1',
      'session-1',
      'all',
    );
    expect(clearCookie).toHaveBeenCalledOnce();
  });
});
