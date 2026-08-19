import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthContext, type AuthenticatedRequest } from './auth-context';
import { AuthService } from './auth.service';
import { SESSION_COOKIE_NAME } from './constants';
import { IS_PUBLIC_KEY } from './public.decorator';

export type SessionAuthService = Pick<AuthService, 'validateToken'>;
export type SessionAuthReflector = Pick<Reflector, 'getAllAndOverride'>;

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthService)
    private readonly authService: SessionAuthService,
    @Inject(Reflector)
    private readonly reflector: SessionAuthReflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Registered as a global APP_GUARD (#68): fail-closed by default, with
    // @Public() as the explicit, reviewable opt-out.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = getRequestToken(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    const session = await this.authService.validateToken(token);
    if (!session?.userId) {
      throw new UnauthorizedException();
    }

    request.authContext = new AuthContext(session.userId, session.sessionId);

    return true;
  }
}

function getRequestToken(request: AuthenticatedRequest): string | undefined {
  // Node's IncomingHttpHeaders types (and documents) `authorization`/`cookie`
  // as always a single string on this platform-express app — duplicates of
  // these specific headers are discarded by Node's own parser, never
  // combined into an array — so no defensive array handling is needed here.
  const bearerToken = extractBearerToken(request.headers.authorization);
  if (bearerToken) {
    return bearerToken;
  }

  const cookieHeader = request.headers.cookie;
  return cookieHeader
    ? parseCookie(cookieHeader)[SESSION_COOKIE_NAME]
    : undefined;
}

function extractBearerToken(header: string | undefined): string | undefined {
  // RFC 6750 §2.1: the auth-scheme is case-insensitive; also tolerate repeated
  // whitespace between scheme and token ("Bearer   <token>").
  return header?.match(/^bearer\s+(\S+)\s*$/i)?.[1];
}

function parseCookie(header: string): Record<string, string> {
  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) {
      return cookies;
    }

    try {
      cookies[rawName] = decodeURIComponent(rawValue.join('='));
    } catch {
      return cookies;
    }

    return cookies;
  }, {});
}
