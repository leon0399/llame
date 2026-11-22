import { sql } from 'drizzle-orm';
import { check, pgPolicy, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';

/**
 * The installation's binding of a Machine name to the instance id its daemon
 * reported at the first successful handshake (host-as-machine D2). A later
 * handshake that reports another id is refused, so a second computer cannot
 * answer for a name the operator already bound.
 *
 * The table is installation state, not tenant data: it carries no owner and no
 * readable-by-users policy, because an instance id never reaches a user or
 * model surface. Only the hub's marked system context may read or write it,
 * which is the same `app.machines_system` marker `machines_status` uses; the
 * operator's `machines:forget` command sets it too.
 *
 * It is deliberately NOT pruned with `machines_status`: a removed and re-added
 * name keeps its binding, so the next handshake still has to match.
 *
 * NOTE: `.enableRLS()` emits ENABLE only; the migration hand-appends FORCE (see
 * apps/api/src/db/AGENTS.md P1). Without FORCE the serving role — which owns
 * this table — would bypass the policy.
 */
export const machineBindings = pgTable(
  'machine_bindings',
  {
    name: text('name').primaryKey(),
    instanceId: uuid('instance_id').notNull(),
    boundAt: timestamptz('bound_at').notNull().defaultNow(),
  },
  (t) => [
    // The configuration grammar for a Machine name, as `machines_status`.
    check('machine_bindings_name_check', sql`${t.name} ~ '^[a-z0-9-]{1,63}$'`),
    // The one policy: the hub's system context. One `for: 'all'` predicate on
    // both USING and WITH CHECK, because PostgreSQL also needs SELECT
    // visibility for the `ON CONFLICT` insert and the read that compares the
    // stored id.
    pgPolicy('machine_bindings_system_write', {
      for: 'all',
      using: sql`current_setting('app.machines_system', true) = '1'`,
      withCheck: sql`current_setting('app.machines_system', true) = '1'`,
    }),
  ],
).enableRLS();
