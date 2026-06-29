import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthContext, type AuthenticatedRequest } from './auth-context';
import { AuthService } from './auth.service';
import { SESSION_COOKIE_NAME } from './constants';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
  const authorization = request.headers.authorization as
    | string
    | string[]
    | undefined;
  const bearerToken = extractBearerToken(
    Array.isArray(authorization) ? authorization[0] : authorization,
  );
  if (bearerToken) {
    return bearerToken;
  }

  const cookieHeader = request.headers.cookie as string | string[] | undefined;
  const header = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  return header ? parseCookie(header)[SESSION_COOKIE_NAME] : undefined;
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
