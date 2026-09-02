import {
  AuthService,
  type AuthPasswordHasher,
  type AuthSessionStore,
  type AuthUserDirectory,
  type SessionMetadata,
  toSessionResponse,
} from './auth.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { SessionTokenService } from './session-token.service';
import type { Session, User } from '../db/schema';

import type { Mocked } from 'vitest';
const user: User = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  emailVerified: null,
  image: null,
  password: '$2a$04$placeholder',
};

const session: Session = {
  id: 'session-1',
  userId: user.id,
  tokenHash: 'token-hash',
  expires: new Date('2026-09-01T00:00:00.000Z'),
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  lastSeenAt: new Date('2026-08-15T00:00:00.000Z'),
  userAgent: 'vitest-agent',
  ip: '127.0.0.1',
};

function makeService(overrides?: {
  users?: Partial<Mocked<AuthUserDirectory>>;
  sessions?: Partial<Mocked<AuthSessionStore>>;
  passwordService?: Partial<Mocked<AuthPasswordHasher>>;
}) {
  const users: Mocked<AuthUserDirectory> = {
    getUserByEmail: vi.fn(),
    getUserById: vi.fn(),
    createUser: vi.fn(),
    ...overrides?.users,
  };

  const sessions: Mocked<AuthSessionStore> = {
    create: vi.fn(),
    findActiveAndTouch: vi.fn(),
    deleteStaleByTokenHash: vi.fn(),
    deleteByIdForUser: vi.fn(),
    deleteCurrentForUser: vi.fn(),
    deleteOthersForUser: vi.fn(),
    deleteAllForUser: vi.fn(),
    listForUser: vi.fn(),
    findByIdForUser: vi.fn(),
    ...overrides?.sessions,
  };

  const passwordService: Mocked<AuthPasswordHasher> = {
    hash: vi.fn(),
    compare: vi.fn(),
    ...overrides?.passwordService,
  };

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
    userAgent: 'vitest-agent',
    ip: '127.0.0.1',
  };

  it('login stores only a SHA-256 token hash, never the raw opaque token', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = 'stored-bcrypt-hash';
    const passwordUser = { ...user, password: passwordHash };
    const { service, users, sessions, tokenService, passwordService } =
      makeService({
        users: { getUserByEmail: vi.fn().mockResolvedValue(passwordUser) },
        passwordService: { compare: vi.fn().mockResolvedValue(true) },
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

  it('registers a normalized email, hashes the password, and issues a session', async () => {
    const created: User = { ...user, password: 'hashed-password' };
    const { service, users, passwordService, sessions } = makeService({
      users: {
        getUserByEmail: vi.fn().mockResolvedValue(undefined),
        createUser: vi.fn().mockResolvedValue(created),
      },
      passwordService: { hash: vi.fn().mockResolvedValue('hashed-password') },
      sessions: { create: vi.fn().mockResolvedValue(session) },
    });

    const result = await service.register(
      { email: '  ALICE@EXAMPLE.COM ', name: 'Alice', password: 'secret' },
      metadata,
    );

    expect(users.getUserByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(passwordService.hash).toHaveBeenCalledWith('secret');
    expect(users.createUser).toHaveBeenCalledWith({
      email: 'alice@example.com',
      name: 'Alice',
      password: 'hashed-password',
    });
    expect(result.user).toMatchObject({ id: user.id, email: user.email });
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
    );
  });

  it('rejects duplicate registrations before hashing', async () => {
    const { service, passwordService } = makeService({
      users: { getUserByEmail: vi.fn().mockResolvedValue(user) },
    });

    await expect(
      service.register(
        { email: ' ALICE@example.com ', name: 'Alice', password: 'secret' },
        metadata,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(passwordService.hash).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique-email insert to a conflict and rethrows other failures', async () => {
    const uniqueFailure = Object.assign(new Error('duplicate'), {
      code: '23505',
    });
    const { service: uniqueService } = makeService({
      users: {
        getUserByEmail: vi.fn().mockResolvedValue(undefined),
        createUser: vi.fn().mockRejectedValue(uniqueFailure),
      },
      passwordService: { hash: vi.fn().mockResolvedValue('hash') },
    });

    await expect(
      uniqueService.register(
        { email: 'alice@example.com', name: 'Alice', password: 'secret' },
        metadata,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const otherFailure = new Error('database offline');
    const { service: otherService } = makeService({
      users: {
        getUserByEmail: vi.fn().mockResolvedValue(undefined),
        createUser: vi.fn().mockRejectedValue(otherFailure),
      },
      passwordService: { hash: vi.fn().mockResolvedValue('hash') },
    });
    await expect(
      otherService.register(
        { email: 'alice@example.com', name: 'Alice', password: 'secret' },
        metadata,
      ),
    ).rejects.toBe(otherFailure);
  });

  it('rejects missing passwords and password mismatches during login', async () => {
    const { service: missingPasswordService, passwordService } = makeService({
      users: {
        getUserByEmail: vi.fn().mockResolvedValue({ ...user, password: null }),
      },
    });
    await expect(
      missingPasswordService.login(
        { email: 'alice@example.com', password: 'secret' },
        metadata,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwordService.compare).not.toHaveBeenCalled();

    const { service: mismatchService } = makeService({
      users: { getUserByEmail: vi.fn().mockResolvedValue(user) },
      passwordService: { compare: vi.fn().mockResolvedValue(false) },
    });
    await expect(
      mismatchService.login(
        { email: 'alice@example.com', password: 'wrong' },
        metadata,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('validateToken returns undefined for revoked or unknown sessions', async () => {
    const { service, sessions } = makeService({
      sessions: { findActiveAndTouch: vi.fn().mockResolvedValue(undefined) },
    });

    await expect(
      service.validateToken('revoked-token'),
    ).resolves.toBeUndefined();
    // Stale-row housekeeping runs on the miss path (best-effort delete).
    expect(sessions.deleteStaleByTokenHash).toHaveBeenCalled();
  });

  it('ignores blank tokens and keeps stale-session cleanup best-effort', async () => {
    const { service, sessions } = makeService({
      sessions: {
        deleteStaleByTokenHash: vi.fn().mockRejectedValue(new Error('offline')),
      },
    });

    await expect(service.validateToken('   ')).resolves.toBeUndefined();
    expect(sessions.findActiveAndTouch).not.toHaveBeenCalled();

    sessions.findActiveAndTouch.mockResolvedValue({ ...session, userId: '  ' });
    await expect(service.validateToken('token')).resolves.toBeUndefined();
    expect(sessions.deleteStaleByTokenHash).toHaveBeenCalledOnce();
  });

  it('returns the verified public user and rejects an absent user', async () => {
    const { service } = makeService({
      users: { getUserById: vi.fn().mockResolvedValue(user) },
    });
    await expect(service.getCurrentUser(user.id)).resolves.toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
    });

    const { service: missingService } = makeService({
      users: { getUserById: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(missingService.getCurrentUser(user.id)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lists sessions and marks only the current session', async () => {
    const second = { ...session, id: 'session-2' };
    const { service, sessions } = makeService({
      sessions: { listForUser: vi.fn().mockResolvedValue([session, second]) },
    });

    await expect(service.listSessions(user.id, session.id)).resolves.toEqual({
      sessions: [
        expect.objectContaining({ id: session.id, current: true }),
        expect.objectContaining({ id: second.id, current: false }),
      ],
    });
    expect(sessions.listForUser).toHaveBeenCalledWith(
      user.id,
      expect.any(Number),
    );
  });

  it('returns or rejects the current session using its owner and id', async () => {
    const { service, sessions } = makeService({
      sessions: { findByIdForUser: vi.fn().mockResolvedValue(session) },
    });
    await expect(
      service.getCurrentSession(user.id, session.id),
    ).resolves.toEqual(
      expect.objectContaining({ id: session.id, current: true }),
    );

    sessions.findByIdForUser.mockResolvedValue(undefined);
    await expect(
      service.getCurrentSession(user.id, session.id),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes one session or all/other sessions according to scope', async () => {
    const { service, sessions } = makeService({
      sessions: {
        deleteByIdForUser: vi.fn().mockResolvedValue(1),
        deleteOthersForUser: vi.fn().mockResolvedValue(2),
        deleteAllForUser: vi.fn().mockResolvedValue(3),
      },
    });

    await expect(service.revokeSession(user.id, 'session-2')).resolves.toEqual({
      revokedCount: 1,
    });
    await expect(service.revokeSessions(user.id, session.id)).resolves.toEqual({
      revokedCount: 2,
    });
    await expect(
      service.revokeSessions(user.id, session.id, 'all'),
    ).resolves.toEqual({ revokedCount: 3 });
    expect(sessions.deleteByIdForUser).toHaveBeenCalledWith(
      user.id,
      'session-2',
    );
    expect(sessions.deleteOthersForUser).toHaveBeenCalledWith(
      user.id,
      session.id,
    );
    expect(sessions.deleteAllForUser).toHaveBeenCalledWith(user.id);
  });

  it('rejects issuing a session for an empty tenant identity', async () => {
    const { service } = makeService({
      users: {
        getUserByEmail: vi.fn().mockResolvedValue(undefined),
        createUser: vi.fn().mockResolvedValue({ ...user, id: ' ' }),
      },
      passwordService: { hash: vi.fn().mockResolvedValue('hash') },
    });

    await expect(
      service.register(
        { email: 'alice@example.com', name: 'Alice', password: 'secret' },
        metadata,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps session response fields and current status', () => {
    expect(toSessionResponse(session, session.id)).toEqual({
      id: session.id,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expires: session.expires,
      current: true,
    });
    expect(toSessionResponse(session, 'other')).toMatchObject({
      current: false,
    });
  });

  it('revokeCurrentSession deletes the current session and a later validation fails', async () => {
    const { service, sessions, tokenService } = makeService();
    const token = 'token-to-revoke';
    const tokenHash = tokenService.hashToken(token);
    sessions.findActiveAndTouch
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
    sessions.deleteStaleByTokenHash.mockResolvedValue(undefined);
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
