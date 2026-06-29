import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SESSION_IDLE_TTL_MS, SESSION_TTL_MS } from './constants';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import {
  AuthTokenResponse,
  SessionResponse,
  SessionRevocationResponse,
  SessionsResponse,
} from './dto/auth.responses';
import { SessionTokenService } from './session-token.service';
import { type SessionRecord, SessionsRepository } from './sessions.repository';
import { PasswordService } from './password.service';
import type { User } from '../db/schema';
import { PublicUserResponse } from '../users/public-user.response';
import { toPublicUser, UsersService } from '../users/users.service';

export type SessionMetadata = {
  userAgent?: string;
  ip?: string;
};

export type ValidatedSession = {
  userId: string;
  sessionId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsRepository: SessionsRepository,
    private readonly sessionTokenService: SessionTokenService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(
    input: RegisterDto,
    metadata: SessionMetadata,
  ): Promise<AuthTokenResponse> {
    const email = normalizeEmail(input.email);
    const existing = await this.usersService.getUserByEmail(email);
    if (existing) {
      throw new ConflictException('User already exists');
    }

    const passwordHash = await this.passwordService.hash(input.password);
    let user: User;
    try {
      user = await this.usersService.createUser({
        email,
        name: input.name,
        password: passwordHash,
      });
    } catch (error) {
      // The existence check above is racy: two concurrent registrations for the same
      // email both pass it. The DB unique constraint on users.email is the real guard —
      // map its violation to 409 instead of leaking an unhandled 500.
      if (isUniqueViolation(error)) {
        throw new ConflictException('User already exists');
      }
      throw error;
    }

    return this.issueSession(user, metadata);
  }

  async login(
    input: LoginDto,
    metadata: SessionMetadata,
  ): Promise<AuthTokenResponse> {
    const email = normalizeEmail(input.email);
    const user = await this.usersService.getUserByEmail(email);
    if (!user?.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await this.passwordService.compare(
      input.password,
      user.password,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueSession(user, metadata);
  }

  async validateToken(token: string): Promise<ValidatedSession | undefined> {
    if (!token.trim()) {
      return undefined;
    }

    const tokenHash = this.sessionTokenService.hashToken(token);
    const session = await this.sessionsRepository.findByTokenHash(tokenHash);
    if (!session?.userId.trim()) {
      return undefined;
    }

    if (this.isExpiredOrIdle(session)) {
      await this.sessionsRepository.deleteCurrentForUser(
        session.userId,
        session.id,
      );
      return undefined;
    }

    await this.sessionsRepository.updateLastSeenAt(session.id, new Date());

    return { userId: session.userId, sessionId: session.id };
  }

  async getCurrentUser(userId: string): Promise<PublicUserResponse> {
    const user = await this.usersService.getUserById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }

    return toPublicUser(user);
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionsResponse> {
    const sessionRows = await this.sessionsRepository.listForUser(userId);

    return {
      sessions: sessionRows.map((session) =>
        toSessionResponse(session, currentSessionId),
      ),
    };
  }

  async getCurrentSession(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionResponse> {
    const sessionRows = await this.sessionsRepository.listForUser(userId);
    const current = sessionRows.find(
      (session) => session.id === currentSessionId,
    );
    if (!current) {
      throw new UnauthorizedException();
    }

    return toSessionResponse(current, currentSessionId);
  }

  async revokeCurrentSession(
    userId: string,
    currentSessionId: string,
  ): Promise<number> {
    return this.sessionsRepository.deleteCurrentForUser(
      userId,
      currentSessionId,
    );
  }

  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<SessionRevocationResponse> {
    return {
      revokedCount: await this.sessionsRepository.deleteByIdForUser(
        userId,
        sessionId,
      ),
    };
  }

  async revokeSessions(
    userId: string,
    currentSessionId: string,
    scope: 'others' | 'all' = 'others',
  ): Promise<SessionRevocationResponse> {
    const revokedCount =
      scope === 'all'
        ? await this.sessionsRepository.deleteAllForUser(userId)
        : await this.sessionsRepository.deleteOthersForUser(
            userId,
            currentSessionId,
          );

    return { revokedCount };
  }

  private async issueSession(
    user: User,
    metadata: SessionMetadata,
  ): Promise<AuthTokenResponse> {
    if (!user.id.trim()) {
      throw new UnauthorizedException('Tenant identity is required');
    }

    const token = this.sessionTokenService.generateToken();
    const session = await this.sessionsRepository.create({
      userId: user.id,
      tokenHash: this.sessionTokenService.hashToken(token),
      expires: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: metadata.userAgent,
      ip: metadata.ip,
    });

    return {
      token,
      user: toPublicUser(user),
      session: toSessionResponse(session, session.id),
    };
  }

  private isExpiredOrIdle(session: SessionRecord): boolean {
    const now = Date.now();
    return (
      session.expires.getTime() <= now ||
      session.lastSeenAt.getTime() <= now - SESSION_IDLE_TTL_MS
    );
  }
}

export function toSessionResponse(
  session: SessionRecord,
  currentSessionId: string,
): SessionResponse {
  return {
    id: session.id,
    userAgent: session.userAgent,
    ip: session.ip,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expires: session.expires,
    current: session.id === currentSessionId,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Postgres unique-violation SQLSTATE (postgres.js surfaces it as `error.code`).
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
