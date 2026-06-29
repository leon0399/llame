import { Module } from '@nestjs/common';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({
  controllers: [ChatsController],
  providers: [TenantDbService, ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
