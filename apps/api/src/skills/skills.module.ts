import { Module } from '@nestjs/common';

import { InstanceConfigModule } from '../instance-config/instance-config.module';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { SkillCatalog } from './skill-catalog';
import { SkillsController } from './skills.controller';

/**
 * The single in-process provider of the skill catalog port (design D1). The
 * configured source list is fixed at boot; discovery itself is live, so package
 * edits inside those sources need no restart.
 */
@Module({
  imports: [InstanceConfigModule],
  controllers: [SkillsController],
  providers: [
    {
      provide: SkillCatalog,
      inject: [InstanceConfigService],
      useFactory: (instanceConfig: InstanceConfigService) =>
        new SkillCatalog(instanceConfig.config.skills.directories),
    },
  ],
  exports: [SkillCatalog],
})
export class SkillsModule {}
