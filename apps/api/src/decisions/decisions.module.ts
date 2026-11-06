import { Module } from '@nestjs/common';

import { DecisionsService } from './decisions.service';

/**
 * DecisionsModule — the System One decision lane. It owns one client per
 * `decisionModels[]` entry and exposes `DecisionsService.judgeCandidates` and
 * `protectText` to the run executor, which hands them to tools as
 * `ToolContext.decisions`. An instance with no `decisionModels[]` builds no
 * client and every judge call is `unavailable`, so tools keep their canonical
 * order.
 */
@Module({
  providers: [DecisionsService],
  exports: [DecisionsService],
})
export class DecisionsModule {}
