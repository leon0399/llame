/**
 * MachinesStatusRepository — the `machines_status` table's two access paths,
 * kept in one place so the RLS split is visible rather than implied:
 *
 * - WRITES (a session event, the probe job) run on the identity-less `DB_DEV`
 *   connection inside a transaction that marks itself as the system context
 *   (`app.machines_system`), which is the one policy that admits them. The
 *   marker is transaction-local and no request path sets it, so a user request
 *   cannot write status.
 * - READS run under `runAs(userId)`, the only context the select policy admits,
 *   so an unauthenticated caller gets no rows even if a handler forgot a filter.
 */

import { Inject, Injectable } from '@nestjs/common';
import { inArray, notInArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import * as schema from '../db/schema';
import { machinesStatus } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';

import {
  boundMachineRoots,
  boundMachineVersion,
  isMachineFailureReason,
  type MachineContact,
  type MachineStatusRow,
} from './machines-status';

/** The transaction-local setting that marks the hub's own status writer. */
const SYSTEM_MARKER = sql`select set_config('app.machines_system', '1', true)`;

/** The row one contact produces, with every daemon-supplied value bounded. */
function contactRow(
  contact: MachineContact,
): typeof machinesStatus.$inferInsert {
  const success = contact.failure === undefined;
  return {
    name: contact.name,
    firstContactAt: success ? contact.at : null,
    lastContactAt: success ? contact.at : null,
    lastFailureAt: success ? null : contact.at,
    lastFailureReason: contact.failure ?? null,
    hubProtocolVersion: contact.hubProtocolVersion,
    daemonProtocolVersion: contact.daemonProtocolVersion ?? null,
    daemonVersion: boundMachineVersion(contact.daemonVersion) ?? null,
    roots: boundMachineRoots(contact.roots),
    updatedAt: contact.at,
  };
}

/**
 * What a repeat contact changes. A success re-stamps the contact and the
 * daemon's report, keeping the last failure (the derivation compares the two);
 * a failure touches only the failure fields, so an unreachable Machine never
 * looks seen. Probe and session writers can commit out of order, so each
 * timestamp keeps the later of the stored and the new value, and a failure
 * reason changes only with the failure time it belongs to. The first
 * successful contact is set by the first success, which need not be the
 * row's first observation.
 */
function contactUpdate(
  contact: MachineContact,
  row: typeof machinesStatus.$inferInsert,
): PgUpdateSetSource<typeof machinesStatus> {
  if (contact.failure === undefined)
    return {
      firstContactAt: sql`coalesce(${machinesStatus.firstContactAt}, excluded.first_contact_at)`,
      lastContactAt: sql`greatest(${machinesStatus.lastContactAt}, excluded.last_contact_at)`,
      hubProtocolVersion: row.hubProtocolVersion,
      daemonProtocolVersion: row.daemonProtocolVersion,
      daemonVersion: row.daemonVersion,
      roots: row.roots,
      updatedAt: row.updatedAt,
    };
  return {
    lastFailureReason: sql`case when ${machinesStatus.lastFailureAt} is null or excluded.last_failure_at >= ${machinesStatus.lastFailureAt} then excluded.last_failure_reason else ${machinesStatus.lastFailureReason} end`,
    lastFailureAt: sql`greatest(${machinesStatus.lastFailureAt}, excluded.last_failure_at)`,
    hubProtocolVersion: row.hubProtocolVersion,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class MachinesStatusRepository {
  constructor(
    @Inject('DB_DEV')
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly tenantDb: TenantDbService,
  ) {}

  /**
   * Record one observed contact. A successful contact sets the contact
   * timestamps (first_contact_at at the first success); a failure sets only the
   * failure fields, so an unreachable Machine never looks seen. The last
   * failure is deliberately kept through a later success: the derivation needs
   * it to decide whether the contact came after it.
   */
  async recordContact(contact: MachineContact): Promise<void> {
    const row = contactRow(contact);
    await this.db.transaction(async (tx) => {
      await tx.execute(SYSTEM_MARKER);
      await tx
        .insert(machinesStatus)
        .values(row)
        .onConflictDoUpdate({
          target: machinesStatus.name,
          set: contactUpdate(contact, row),
        });
    });
  }

  /** Rows for the Machines still configured, read under the caller's identity. */
  async listForUser(
    userId: string,
    names: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<MachineStatusRow>> {
    if (names.length === 0) return [];
    return this.tenantDb.runAs(userId, async (tx) => {
      const rows = await tx
        .select()
        .from(machinesStatus)
        .where(inArray(machinesStatus.name, [...names]));
      // The CHECK constrains the column to the closed set; the guard keeps
      // the mapping honest without asserting a shape.
      return rows.map((row) => ({
        ...row,
        lastFailureReason: isMachineFailureReason(row.lastFailureReason)
          ? row.lastFailureReason
          : null,
      }));
    });
  }

  /**
   * Drop the status of Machines no longer configured. Returns how many rows
   * went, from the statement's own row count; no row has to come back.
   */
  async pruneExcept(names: ReadonlyArray<string>): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(SYSTEM_MARKER);
      const deleted =
        names.length === 0
          ? await tx.delete(machinesStatus)
          : await tx
              .delete(machinesStatus)
              .where(notInArray(machinesStatus.name, [...names]));
      return deleted.count ?? 0;
    });
  }
}
