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
  if (!request.authContext?.userId) {
    throw new UnauthorizedException();
  }

  return request.authContext;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    return getAuthContext(context).userId;
  },
);

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    return getAuthContext(context).sessionId;
  },
);
