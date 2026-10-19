/**
 * MachinesService — the read model behind `GET /api/v1/machines`: the
 * CONFIGURED Machines (that is the list) joined with their recorded status.
 * A Machine llame has never contacted, or whose last contact failed, is
 * offline with its failure reason rather than absent, so the list never
 * silently shrinks.
 */

import { Injectable } from '@nestjs/common';

import { MachineConnector } from './machine-connector.service';
import { MachinesStatusRepository } from './machines-status.repository';
import { machineStatusView, type MachineStatusView } from './machines-status';

@Injectable()
export class MachinesService {
  constructor(
    private readonly connector: MachineConnector,
    private readonly status: MachinesStatusRepository,
  ) {}

  /** Every configured Machine, with the status its records derive. */
  async list(userId: string): Promise<ReadonlyArray<MachineStatusView>> {
    const names = this.connector.names();
    const rows = await this.status.listForUser(userId, names);
    const byName = new Map(rows.map((row) => [row.name, row]));
    const now = Date.now();
    return names.map((name) => machineStatusView(name, byName.get(name), now));
  }
}
