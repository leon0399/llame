import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PersonalizationController } from './personalization.controller';
import { PersonalizationService } from './personalization.service';

@Module({
  imports: [AuthModule],
  controllers: [PersonalizationController],
  providers: [PersonalizationService],
  exports: [PersonalizationService],
})
export class PersonalizationModule {}
