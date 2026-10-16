import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ChangeHubService } from './change-hub.service';
import { LiveGatewayService } from './live-gateway.service';
import {
  LIVE_RECORD_LOADER,
  TenantLiveRecordLoader,
} from './live-record-loader';

/**
 * Owner-scoped live updates over WebSocket. API process only: the gateway
 * attaches to the HTTP server, and a worker-only process has none.
 */
@Module({
  imports: [AuthModule],
  providers: [
    ChangeHubService,
    LiveGatewayService,
    { provide: LIVE_RECORD_LOADER, useClass: TenantLiveRecordLoader },
  ],
})
export class LiveModule {}
