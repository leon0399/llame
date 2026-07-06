import { Module } from '@nestjs/common';

import { ConfigResolverModule } from '../config-resolver/config-resolver.module';
import { ProvidersModule } from '../providers/providers.module';

import { ModelsController } from './models.controller';
import { ModelsService } from './models.service';

// The models controller exposes only the caller's own available set (#76),
// scoped by the authenticated identity (#60) — never another user's
// providers. ModelsService is exported for the chat run pipeline. The config
// resolver supplies the per-user model allowlist (#85).
@Module({
  imports: [ProvidersModule, ConfigResolverModule],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService],
})
export class ModelsModule {}
