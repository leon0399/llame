import { Module } from '@nestjs/common';

import { PersonalizationService } from './personalization.service';

@Module({
  providers: [PersonalizationService],
  exports: [PersonalizationService],
})
export class PersonalizationModule {}
