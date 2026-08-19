import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

export class AuthContext {
  constructor(
    readonly userId: string,
    readonly sessionId: string,
  ) {}
}

export type AuthenticatedRequest = Request & {
  authContext?: AuthContext;
};

function getAuthContext(context: ExecutionContext): AuthContext {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  // Fail closed on a partial context: @CurrentSession trusts sessionId, so require both.
  if (!request.authContext?.userId || !request.authContext.sessionId) {
    throw new UnauthorizedException();
  }

  return request.authContext;
}

export const CurrentUser = createParamDecorator(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- mirrors NestJS's own `ParamDecoratorCallback` signature (`data: unknown` in `@nestjs/common`); this decorator ignores it, no domain type to accept.
  (_data: unknown, context: ExecutionContext): string => {
    return getAuthContext(context).userId;
  },
);

export const CurrentSession = createParamDecorator(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- mirrors NestJS's own `ParamDecoratorCallback` signature (`data: unknown` in `@nestjs/common`); this decorator ignores it, no domain type to accept.
  (_data: unknown, context: ExecutionContext): string => {
    return getAuthContext(context).sessionId;
  },
);
