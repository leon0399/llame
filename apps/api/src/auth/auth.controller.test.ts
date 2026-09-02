import type { Response } from 'express';
import { clearSessionCookie, setSessionCookie } from './auth.controller';
import { SESSION_COOKIE_NAME } from './constants';

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
