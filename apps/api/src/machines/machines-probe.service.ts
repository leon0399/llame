/**
 * MachinesProbeService — the background retry the Machines list needs
 * (remote-machines spec "Machine status is derived from contact and visible").
 * Once a minute it asks the connector whether each configured Machine is
 * reachable, which opens a session when none is open and re-stamps the contact
 * on one that is, and prunes the rows of Machines the operator removed.
 *
 * Gated on the `runs` group, deliberately: Machines exist to execute Runs on,
 * so a process that consumes no Runs — an HTTP-only profile — never dials one,
 * and the operator keeps a single switch for "this process talks to Machines".
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { QUEUE, type Queue } from '../queue/queue';

import { MachineConnector } from './machine-connector.service';
import { MACHINES_PROBE_CRON, MACHINES_PROBE_QUEUE } from './machines-queues';
import { MachinesStatusRepository } from './machines-status.repository';

@Injectable()
export class MachinesProbeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MachinesProbeService.name);

  constructor(
    @Inject(QUEUE)
    private readonly queue: Queue,
    private readonly connector: MachineConnector,
    private readonly status: MachinesStatusRepository,
    private readonly workerProfile: WorkerProfileService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Without a `machines` section there is nothing to probe, and a Machine
    // surface must not exist: register nothing at all.
    if (!this.connector.enabled()) return;
    const concurrency = this.workerProfile.concurrencyFor('runs');
    if (concurrency === null) return;
    await this.queue.ensureQueue(MACHINES_PROBE_QUEUE);
    await this.queue.schedule(MACHINES_PROBE_QUEUE, MACHINES_PROBE_CRON);
    await this.queue.consume(MACHINES_PROBE_QUEUE, () => this.probe(), {
      concurrency,
    });
  }

  private async probe(): Promise<void> {
    const names = this.connector.names();
    // One attempt key per tick, so a Machine that just recovered is retried on
    // the NEXT tick rather than repeatedly inside this one.
    const attemptKey = `probe:${Date.now()}`;
    for (const name of names) await this.connector.reachable(name, attemptKey);
    const pruned = await this.status.pruneExcept(names);
    if (pruned > 0)
      this.logger.log(`Pruned ${pruned} status row(s) of removed Machine(s)`);
  }
}
