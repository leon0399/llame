import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module';

import { ModelsService } from './models.service';

// No HTTP controller — deliberately. Per-user model credentials require an
// authenticated identity (#60) to avoid IDOR. ModelsService is exported for
// internal use by the #55 Q&A run worker.
@Module({
  imports: [ProvidersModule],
  providers: [ModelsService],
  exports: [ModelsService],
})
export class ModelsModule {}
