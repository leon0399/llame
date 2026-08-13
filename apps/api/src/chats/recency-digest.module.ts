import { Module } from '@nestjs/common';

import { RecencyDigestService } from './recency-digest.service';

@Module({
  providers: [RecencyDigestService],
  exports: [RecencyDigestService],
})
export class RecencyDigestModule {}
