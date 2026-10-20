/**
 * MachinesModule — the hub's remote-Machine surface: the connector (sessions,
 * requests, channels), the status reader/writer, the API list, and the probe
 * job. Imported by both entrypoints, because a worker needs the connector for
 * tool execution and the probe, and the API process needs the route.
 *
 * The connector is built by a factory rather than Nest's own construction so
 * its dependency on the resolved `machines` section is explicit: an instance
 * without the section gets a connector that answers `enabled() === false` and
 * never opens a link.
 */

import { Logger, Module } from '@nestjs/common';

import { InstanceConfigService } from '../instance-config/instance-config.service';
import { QueueModule } from '../queue/queue.module';

import { MachineConnector } from './machine-connector.service';
import { MachinesController } from './machines.controller';
import { MachinesProbeService } from './machines-probe.service';
import { MachinesService } from './machines.service';
import { MachinesStatusRepository } from './machines-status.repository';

@Module({
  // QueueModule supplies the probe job's QUEUE token, exactly as AuthModule and
  // SearchModule do for their cron consumers.
  imports: [QueueModule],
  controllers: [MachinesController],
  providers: [
    {
      provide: MachineConnector,
      inject: [InstanceConfigService, MachinesStatusRepository],
      useFactory: (
        instanceConfig: InstanceConfigService,
        status: MachinesStatusRepository,
      ) => {
        const logger = new Logger(MachineConnector.name);
        return new MachineConnector({
          machines: instanceConfig.config.machines,
          // The handshake's hub version is llame's own identity token
          // (`llame/<version>`, read once at boot from the API manifest).
          hubVersion: instanceConfig.productUserAgent,
          onContact: (contact) => status.recordContact(contact),
          logger,
        });
      },
    },
    MachinesStatusRepository,
    MachinesService,
    MachinesProbeService,
  ],
  exports: [MachineConnector, MachinesService, MachinesStatusRepository],
})
export class MachinesModule {}
