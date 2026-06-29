import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

// HTTP endpoints are safe to expose only because SessionAuthGuard derives the tenant
// identity from a verified session. Controllers must never accept ownerUserId from
// client input; that would recreate the #61 tenant-impersonation IDOR.
@Module({
  imports: [AuthModule],
  controllers: [ChatsController],
  providers: [TenantDbService, ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
