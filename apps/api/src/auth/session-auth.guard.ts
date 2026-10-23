import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { AuthContext, type AuthenticatedRequest } from './auth-context';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { getRequestToken } from './request-token';

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
    // Scoped to this request's isolation scope; the opaque id only.
    Sentry.setUser({ id: session.userId });

    return true;
  }
}
