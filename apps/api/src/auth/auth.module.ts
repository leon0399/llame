import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionTokenService } from './session-token.service';
import { SessionsRepository } from './sessions.repository';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionsRepository,
    SessionAuthGuard,
    SessionTokenService,
  ],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
