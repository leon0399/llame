import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { CookieOptions } from 'express';
import { CurrentSession, CurrentUser } from './auth-context';
import { AuthService, type SessionMetadata } from './auth.service';
import {
  AUTH_RATE_LIMIT_PER_MINUTE,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_SECURE,
} from './constants';
import { LoginDto, RegisterDto, RevokeSessionsQueryDto } from './dto/auth.dto';
import {
  AuthTokenResponse,
  SessionResponse,
  SessionRevocationResponse,
  SessionsResponse,
} from './dto/auth.responses';
import { Public } from './public.decorator';
import { PublicUserResponse } from '../users/public-user.response';

@ApiTags('auth')
@Controller('auth/v1')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  // Brute-force / mass-signup ceiling (#68), per client IP.
  @Throttle({ default: { ttl: 60_000, limit: AUTH_RATE_LIMIT_PER_MINUTE } })
  @Post('register')
  @ApiCreatedResponse({ type: AuthTokenResponse })
  @ApiConflictResponse({ description: 'Email already registered' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async register(
    @Body() input: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokenResponse> {
    // Resolve (and validate) cookie config BEFORE persisting anything, so a prod
    // misconfiguration fails the request without committing a user/session it can't
    // then set a cookie for.
    const cookieOptions = getSessionCookieOptions();
    const result = await this.authService.register(
      input,
      getSessionMetadata(request),
    );
    setSessionCookie(
      response,
      result.token,
      result.session.expires,
      cookieOptions,
    );

    return result;
  }

  @Public()
  // Credential brute-force ceiling (#68): each attempt costs a bcrypt compare.
  @Throttle({ default: { ttl: 60_000, limit: AUTH_RATE_LIMIT_PER_MINUTE } })
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthTokenResponse })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokenResponse> {
    const cookieOptions = getSessionCookieOptions();
    const result = await this.authService.login(
      input,
      getSessionMetadata(request),
    );
    setSessionCookie(
      response,
      result.token,
      result.session.expires,
      cookieOptions,
    );

    return result;
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiCookieAuth('cookie')
  @ApiOkResponse({ type: PublicUserResponse })
  @ApiUnauthorizedResponse()
  async me(@CurrentUser() userId: string): Promise<PublicUserResponse> {
    return this.authService.getCurrentUser(userId);
  }

  @Get('sessions')
  @ApiBearerAuth('bearer')
  @ApiCookieAuth('cookie')
  @ApiOkResponse({ type: SessionsResponse })
  @ApiUnauthorizedResponse()
  async sessions(
    @CurrentUser() userId: string,
    @CurrentSession() sessionId: string,
  ): Promise<SessionsResponse> {
    return this.authService.listSessions(userId, sessionId);
  }

  @Get('sessions/current')
  @ApiBearerAuth('bearer')
  @ApiCookieAuth('cookie')
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse()
  async currentSession(
    @CurrentUser() userId: string,
    @CurrentSession() sessionId: string,
  ): Promise<SessionResponse> {
    return this.authService.getCurrentSession(userId, sessionId);
  }

  @Delete('sessions/current')
  @ApiBearerAuth('bearer')
  @ApiCookieAuth('cookie')
  @ApiOkResponse({ type: SessionRevocationResponse })
  @ApiUnauthorizedResponse()
  async logout(
    @CurrentUser() userId: string,
    @CurrentSession() sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionRevocationResponse> {
    // Resolve (and validate) cookie config before revoking, so a prod misconfig
    // can't revoke the session and then 500 leaving the stale cookie in the browser.
    const cookieOptions = getSessionCookieOptions();
    const revokedCount = await this.authService.revokeCurrentSession(
      userId,
      sessionId,
    );
    clearSessionCookie(response, cookieOptions);

    return { revokedCount };
  }

  @Delete('sessions/:id')
  @ApiBearerAuth('bearer')
  @ApiCookieAuth('cookie')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SessionRevocationResponse })
  @ApiBadRequestResponse({ description: 'Malformed session id (not a UUID)' })
  @ApiUnauthorizedResponse()
  async revokeSession(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<SessionRevocationResponse> {
    return this.authService.revokeSession(userId, sessionId);
  }

  @Delete('sessions')
  @ApiBearerAuth('bearer')
  @ApiCookieAuth('cookie')
  @ApiOkResponse({ type: SessionRevocationResponse })
  @ApiUnauthorizedResponse()
  async revokeSessions(
    @CurrentUser() userId: string,
    @CurrentSession() sessionId: string,
    @Query() query: RevokeSessionsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionRevocationResponse> {
    // Validate cookie config before revoking when we'll need to clear the cookie.
    const cookieOptions =
      query.scope === 'all' ? getSessionCookieOptions() : undefined;
    const result = await this.authService.revokeSessions(
      userId,
      sessionId,
      query.scope ?? 'others',
    );
    if (query.scope === 'all') {
      clearSessionCookie(response, cookieOptions);
    }

    return result;
  }
}

function getSessionMetadata(request: Request): SessionMetadata {
  return {
    userAgent: request.get('user-agent'),
    ip: request.ip ?? request.socket.remoteAddress,
  };
}

export function setSessionCookie(
  response: Response,
  token: string,
  expires: Date,
  options: CookieOptions = getSessionCookieOptions(),
): void {
  response.cookie(SESSION_COOKIE_NAME, token, {
    ...options,
    expires,
  });
}

export function clearSessionCookie(
  response: Response,
  options: CookieOptions = getSessionCookieOptions(),
): void {
  response.clearCookie(SESSION_COOKIE_NAME, options);
}

function getSessionCookieOptions(): CookieOptions {
  const domain = getSessionCookieDomain();

  return {
    httpOnly: true,
    secure: SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

function getSessionCookieDomain(): string | undefined {
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim();
  if (domain) {
    return domain;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_COOKIE_DOMAIN is required in production');
  }

  return undefined;
}
