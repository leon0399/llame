import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionTokenService } from './session-token.service';
import { SessionsRepository } from './sessions.repository';

@Module({
  imports: [UsersModule, QueueModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionsRepository,
    SessionAuthGuard,
    SessionCleanupService,
    SessionTokenService,
  ],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
