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

  it('sets and clears the session cookie with the same configured domain', () => {
    process.env.SESSION_COOKIE_DOMAIN = '.example.com';
    const expires = new Date('2030-01-01T00:00:00.000Z');
    const cookie = jest.fn();
    const clearCookie = jest.fn();
    const response = {
      cookie,
      clearCookie,
    } as unknown as Response;

    setSessionCookie(response, 'raw-session-token', expires);
    clearSessionCookie(response);

    expect(cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      'raw-session-token',
      expect.objectContaining({
        domain: '.example.com',
        expires,
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    expect(clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({
        domain: '.example.com',
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
  });

  it('fails closed in production when the session cookie domain is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_COOKIE_DOMAIN;
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;

    expect(() =>
      setSessionCookie(response, 'raw-session-token', new Date()),
    ).toThrow(/SESSION_COOKIE_DOMAIN/);
    expect(() => clearSessionCookie(response)).toThrow(/SESSION_COOKIE_DOMAIN/);
  });
});
