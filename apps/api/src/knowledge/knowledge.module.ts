import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { InstanceConfigModule } from '../instance-config/instance-config.module';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { KnowledgeSpaceController } from './knowledge-space.controller';
import { KnowledgeSpaceLocalResolver } from './knowledge-space.local-resolver';
import { KnowledgeSpaceService } from './knowledge-space.service';

@Module({
  imports: [AuthModule, InstanceConfigModule],
  controllers: [KnowledgeSpaceController],
  providers: [
    KnowledgeSpaceService,
    {
      provide: KnowledgeSpaceLocalResolver,
      inject: [InstanceConfigService],
      useFactory: (instanceConfig: InstanceConfigService) =>
        new KnowledgeSpaceLocalResolver(instanceConfig.config.knowledge.root),
    },
  ],
  exports: [KnowledgeSpaceService],
})
export class KnowledgeModule {}
