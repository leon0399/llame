import { Module } from '@nestjs/common';

import { SystemPromptsService } from './system-prompts.service';

/**
 * Leaf module: rendering needs nothing but the template it is handed, so this
 * provider has no dependencies and any feature can consume it without dragging
 * the model catalog or the instance config along.
 */
@Module({
  providers: [SystemPromptsService],
  exports: [SystemPromptsService],
})
export class SystemPromptsModule {}
