import { Module } from '@nestjs/common';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsService } from './chats.service';

// No HTTP controller yet — deliberately. Tenant-scoped chat endpoints need an
// AUTHENTICATED identity to drive RLS (app.current_user_id). Until auth lands (#60),
// any route taking ownerUserId from client input would be a tenant-impersonation IDOR:
// the app would set the RLS tenant to whatever the caller supplies, defeating the moat.
// ChatsService is exported for internal use (the #55 Q&A loop) with an auth-derived id.
@Module({
  providers: [TenantDbService, ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
