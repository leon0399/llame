/* eslint-disable @typescript-eslint/unbound-method */

import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import {
  SessionAuthGuard,
  type SessionAuthReflector,
} from './session-auth.guard';
import type { AuthService } from './auth.service';

describe('SessionAuthGuard', () => {
  function makeGuard(
    validateToken: AuthService['validateToken'] = vi.fn(),
    isPublic = false,
  ) {
    const authService = { validateToken };
    const reflector: SessionAuthReflector = {
      getAllAndOverride: vi.fn().mockReturnValue(isPublic),
    };
    return {
      guard: new SessionAuthGuard(authService, reflector),
      authService,
    };
  }

  it('reads Authorization Bearer before the HttpOnly cookie and attaches AuthContext', async () => {
    const { guard, authService } = makeGuard(
      vi.fn().mockResolvedValue({ userId: 'user-1', sessionId: 'session-1' }),
    );
    const request = {
      headers: {
        authorization: 'Bearer bearer-token',
        cookie: 'llame_session=cookie-token',
      },
    };

    await expect(
      guard.canActivate(new ExecutionContextHost([request])),
    ).resolves.toBe(true);

    expect(authService.validateToken).toHaveBeenCalledWith('bearer-token');
    expect(request).toHaveProperty('authContext', {
      userId: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('accepts a case-insensitive scheme and repeated whitespace (RFC 6750)', async () => {
    const { guard, authService } = makeGuard(
      vi.fn().mockResolvedValue({ userId: 'user-1', sessionId: 'session-1' }),
    );
    const request = {
      headers: { authorization: 'bearer    spaced-token' },
    };

    await expect(
      guard.canActivate(new ExecutionContextHost([request])),
    ).resolves.toBe(true);
    expect(authService.validateToken).toHaveBeenCalledWith('spaced-token');
  });

  it('falls back to the HttpOnly cookie when no bearer token is present', async () => {
    const { guard, authService } = makeGuard(
      vi.fn().mockResolvedValue({ userId: 'user-1', sessionId: 'session-1' }),
    );
    const request = {
      headers: {
        cookie: 'theme=dark; llame_session=cookie-token',
      },
    };

    await expect(
      guard.canActivate(new ExecutionContextHost([request])),
    ).resolves.toBe(true);

    expect(authService.validateToken).toHaveBeenCalledWith('cookie-token');
  });

  it('fails closed when the token is missing', async () => {
    const { guard } = makeGuard();

    await expect(
      guard.canActivate(new ExecutionContextHost([{ headers: {} }])),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when the cookie token is malformed', async () => {
    const { guard } = makeGuard();

    await expect(
      guard.canActivate(
        new ExecutionContextHost([
          { headers: { cookie: 'llame_session=%E0%A4%A' } },
        ]),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets a @Public() route through without any token (#68)', async () => {
    const { guard, authService } = makeGuard(vi.fn(), true);

    await expect(
      guard.canActivate(new ExecutionContextHost([{ headers: {} }])),
    ).resolves.toBe(true);
    expect(authService.validateToken).not.toHaveBeenCalled();
  });

  it('fails closed when the token is unknown or revoked', async () => {
    const { guard } = makeGuard(vi.fn().mockResolvedValue(undefined));

    await expect(
      guard.canActivate(
        new ExecutionContextHost([
          { headers: { authorization: 'Bearer revoked-token' } },
        ]),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
