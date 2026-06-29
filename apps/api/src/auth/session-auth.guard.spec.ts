/* eslint-disable @typescript-eslint/unbound-method */

import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';
import type { AuthService } from './auth.service';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  function makeGuard(validateToken = jest.fn()) {
    const authService = {
      validateToken,
    } as unknown as jest.Mocked<AuthService>;
    return { guard: new SessionAuthGuard(authService), authService };
  }

  it('reads Authorization Bearer before the HttpOnly cookie and attaches AuthContext', async () => {
    const { guard, authService } = makeGuard(
      jest.fn().mockResolvedValue({ userId: 'user-1', sessionId: 'session-1' }),
    );
    const request = {
      headers: {
        authorization: 'Bearer bearer-token',
        cookie: 'llame_session=cookie-token',
      },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(authService.validateToken).toHaveBeenCalledWith('bearer-token');
    expect(request).toHaveProperty('authContext', {
      userId: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('accepts a case-insensitive scheme and repeated whitespace (RFC 6750)', async () => {
    const { guard, authService } = makeGuard(
      jest.fn().mockResolvedValue({ userId: 'user-1', sessionId: 'session-1' }),
    );
    const request = {
      headers: { authorization: 'bearer    spaced-token' },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(authService.validateToken).toHaveBeenCalledWith('spaced-token');
  });

  it('falls back to the HttpOnly cookie when no bearer token is present', async () => {
    const { guard, authService } = makeGuard(
      jest.fn().mockResolvedValue({ userId: 'user-1', sessionId: 'session-1' }),
    );
    const request = {
      headers: {
        cookie: 'theme=dark; llame_session=cookie-token',
      },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(authService.validateToken).toHaveBeenCalledWith('cookie-token');
  });

  it('fails closed when the token is missing', async () => {
    const { guard } = makeGuard();

    await expect(
      guard.canActivate(makeContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when the cookie token is malformed', async () => {
    const { guard } = makeGuard();

    await expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { cookie: 'llame_session=%E0%A4%A' },
          }),
        }),
      } as ExecutionContext),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when the token is unknown or revoked', async () => {
    const { guard } = makeGuard(jest.fn().mockResolvedValue(undefined));

    await expect(
      guard.canActivate(
        makeContext({ headers: { authorization: 'Bearer revoked-token' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
