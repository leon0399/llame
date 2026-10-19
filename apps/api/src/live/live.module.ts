import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MachinesModule } from '../machines/machines.module';
import { ChangeHubService } from './change-hub.service';
import {
  LIVE_CHANGE_LISTENER,
  PostgresChangeListener,
} from './change-listener';
import { LiveGatewayService } from './live-gateway.service';
import {
  LIVE_RECORD_LOADER,
  TenantLiveRecordLoader,
} from './live-record-loader';

/**
 * Owner-scoped live updates over WebSocket, plus the instance-wide Machine
 * push. API process only: the gateway attaches to the HTTP server, and a
 * worker-only process has none. `MachinesModule` supplies the status read the
 * Machine push needs.
 */
@Module({
  imports: [AuthModule, MachinesModule],
  providers: [
    ChangeHubService,
    LiveGatewayService,
    { provide: LIVE_RECORD_LOADER, useClass: TenantLiveRecordLoader },
    { provide: LIVE_CHANGE_LISTENER, useClass: PostgresChangeListener },
  ],
})
export class LiveModule {}
