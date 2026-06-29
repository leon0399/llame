/* eslint-disable @typescript-eslint/unbound-method */

import { AuthService, type SessionMetadata } from './auth.service';
import type { PasswordService } from './password.service';
import { SessionTokenService } from './session-token.service';
import type { SessionsRepository } from './sessions.repository';
import type { UsersService } from '../users/users.service';
import type { User } from '../db/schema';

const user: User = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  emailVerified: null,
  image: null,
  password: '$2a$04$placeholder',
};

function makeService(overrides?: {
  users?: Partial<UsersService>;
  sessions?: Partial<SessionsRepository>;
  passwordService?: Partial<PasswordService>;
}) {
  const users = {
    getUserByEmail: jest.fn(),
    getUserById: jest.fn(),
    createUser: jest.fn(),
    ...overrides?.users,
  } as unknown as jest.Mocked<UsersService>;

  const sessions = {
    create: jest.fn(),
    findByTokenHash: jest.fn(),
    updateLastSeenAt: jest.fn(),
    deleteByIdForUser: jest.fn(),
    deleteCurrentForUser: jest.fn(),
    deleteOthersForUser: jest.fn(),
    deleteAllForUser: jest.fn(),
    listForUser: jest.fn(),
    ...overrides?.sessions,
  } as unknown as jest.Mocked<SessionsRepository>;

  const passwordService = {
    hash: jest.fn(),
    compare: jest.fn(),
    ...overrides?.passwordService,
  } as unknown as jest.Mocked<PasswordService>;

  const tokenService = new SessionTokenService();
  const service = new AuthService(
    users,
    sessions,
    tokenService,
    passwordService,
  );

  return { service, users, sessions, tokenService, passwordService };
}

describe('AuthService', () => {
  const metadata: SessionMetadata = {
    userAgent: 'jest-agent',
    ip: '127.0.0.1',
  };

  it('login stores only a SHA-256 token hash, never the raw opaque token', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = 'stored-bcrypt-hash';
    const passwordUser = { ...user, password: passwordHash };
    const { service, users, sessions, tokenService, passwordService } =
      makeService({
        users: { getUserByEmail: jest.fn().mockResolvedValue(passwordUser) },
        passwordService: { compare: jest.fn().mockResolvedValue(true) },
      });
    sessions.create.mockImplementation((input) =>
      Promise.resolve({
        id: 'session-1',
        userId: input.userId,
        tokenHash: input.tokenHash,
        expires: input.expires,
        createdAt: new Date('2026-06-29T00:00:00.000Z'),
        lastSeenAt: new Date('2026-06-29T00:00:00.000Z'),
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
      }),
    );

    const result = await service.login(
      { email: 'alice@example.com', password },
      metadata,
    );

    expect(users.getUserByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(passwordService.compare).toHaveBeenCalledWith(
      password,
      passwordHash,
    );
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        tokenHash: tokenService.hashToken(result.token),
        userAgent: metadata.userAgent,
        ip: metadata.ip,
      }),
    );
    expect(JSON.stringify(sessions.create.mock.calls)).not.toContain(
      result.token,
    );
  });

  it('validateToken returns undefined for revoked or unknown sessions', async () => {
    const { service, sessions } = makeService({
      sessions: { findByTokenHash: jest.fn().mockResolvedValue(undefined) },
    });

    await expect(
      service.validateToken('revoked-token'),
    ).resolves.toBeUndefined();
    expect(sessions.updateLastSeenAt).not.toHaveBeenCalled();
  });

  it('revokeCurrentSession deletes the current session and a later validation fails', async () => {
    const { service, sessions, tokenService } = makeService();
    const token = 'token-to-revoke';
    const tokenHash = tokenService.hashToken(token);
    sessions.findByTokenHash
      .mockResolvedValueOnce({
        id: 'session-1',
        userId: user.id,
        tokenHash,
        expires: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        lastSeenAt: new Date(),
        userAgent: null,
        ip: null,
      })
      .mockResolvedValueOnce(undefined);
    sessions.updateLastSeenAt.mockResolvedValue(undefined);
    sessions.deleteCurrentForUser.mockResolvedValue(1);

    await expect(service.validateToken(token)).resolves.toMatchObject({
      userId: user.id,
      sessionId: 'session-1',
    });
    await expect(
      service.revokeCurrentSession(user.id, 'session-1'),
    ).resolves.toBe(1);
    await expect(service.validateToken(token)).resolves.toBeUndefined();
    expect(sessions.deleteCurrentForUser).toHaveBeenCalledWith(
      user.id,
      'session-1',
    );
  });
});
