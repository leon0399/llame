/**
 * MachineBindingsRepository — the installation's one binding per Machine name
 * to the daemon instance id it first authenticated (host-as-machine D2).
 *
 * Both paths run on the identity-less `DB_DEV` connection inside a transaction
 * that marks itself as the system context (`app.machines_system`) first, which
 * is the only policy `machine_bindings` has. A request path never sets the
 * marker, so no user surface can read or rewrite a binding; the instance id is
 * hub-side installation state and never leaves it.
 *
 * `bindOrCompare` is deliberately one transaction: the insert-or-read pair
 * decides a handshake, and a binding must be durable before the session is
 * allowed to serve a request. `forget` is the operator's rebind (`pnpm --filter
 * api machines:forget`), which prints the id it removed.
 */

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { machineBindings } from '../db/schema';

import { SYSTEM_MARKER } from './machines-status.repository';

/** What a handshake's bind decided: a fresh binding, a match, or a refusal. */
export type BindOutcome = 'bound' | 'match' | 'mismatch';

@Injectable()
export class MachineBindingsRepository {
  constructor(
    @Inject('DB_DEV')
    private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * Record `instanceId` for `name` if nothing is bound yet, otherwise compare.
   * One transaction, so the insert and the read see the same snapshot and the
   * marker precedes both statements.
   */
  async bindOrCompare(name: string, instanceId: string): Promise<BindOutcome> {
    return this.db.transaction(async (tx) => {
      await tx.execute(SYSTEM_MARKER);

      const inserted = await tx
        .insert(machineBindings)
        .values({ name, instanceId })
        .onConflictDoNothing({ target: machineBindings.name })
        .returning({ name: machineBindings.name });

      if (inserted.length > 0) return 'bound';

      const [stored] = await tx
        .select({ instanceId: machineBindings.instanceId })
        .from(machineBindings)
        .where(eq(machineBindings.name, name))
        .limit(1);

      // A binding that vanished between the two statements cannot be verified,
      // so the handshake fails closed rather than binding afresh.
      if (stored === undefined) return 'mismatch';

      return stored.instanceId === instanceId ? 'match' : 'mismatch';
    });
  }

  /**
   * Remove the binding for `name` and return the instance id it held, or
   * undefined when the name was not bound. The next handshake binds afresh.
   */
  async forget(name: string): Promise<string | undefined> {
    return this.db.transaction(async (tx) => {
      await tx.execute(SYSTEM_MARKER);

      const removed = await tx
        .delete(machineBindings)
        .where(eq(machineBindings.name, name))
        .returning({ instanceId: machineBindings.instanceId });

      return removed[0]?.instanceId;
    });
  }
}
