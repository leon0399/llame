import { Module } from '@nestjs/common';

import { DecisionsService } from './decisions.service';

/**
 * DecisionsModule — the experimental System One decision lane. It owns the one
 * client built from the optional `decisions` config block and exposes
 * `DecisionsService.judgeCandidates` to the run executor, which hands it to
 * tools as `ToolContext.decisions`. Nothing here runs unless the operator
 * configured the lane: an instance without `decisions` builds no client and
 * every tool keeps its canonical order.
 */
@Module({
  providers: [DecisionsService],
  exports: [DecisionsService],
})
export class DecisionsModule {}
