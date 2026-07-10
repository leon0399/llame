import { Module } from '@nestjs/common';
import { MePromptsController } from './me-prompts.controller';

// One feature, one module (AGENTS.md convention). Needs nothing beyond the
// globally-provided TenantDbService (DbModule is @Global()) — prompts are a
// standalone resource, not part of the chats domain.
@Module({
  controllers: [MePromptsController],
})
export class PromptsModule {}
