import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';

/**
 * Machine status (remote-machines D9): one row per configured Machine, written
 * only by the hub's own system path — a session event or the minute probe — and
 * read only by authenticated users, so `GET /api/v1/machines` never needs a
 * tenant predicate of its own.
 *
 * Status is DERIVED, not stored: `last_contact_at` is the last SUCCESSFUL
 * handshake and `last_failure_at`/`last_failure_reason` the last failure, and a
 * Machine reads online when the contact is inside the inactivity window and
 * after that failure (machines-status.ts `deriveMachineStatus`). A crashed hub
 * process therefore cannot leave a Machine looking online: nothing refreshes
 * `last_contact_at` and the window closes.
 *
 * Every daemon-supplied field is bounded before it lands here (roots, version);
 * the reason is a closed set mirrored by the CHECK below.
 *
 * NOTE: `.enableRLS()` emits ENABLE only; the migration hand-appends FORCE (see
 * apps/api/src/db/AGENTS.md P1). Without FORCE the serving role — which owns
 * this table — would bypass both policies.
 */
export const machinesStatus = pgTable(
  'machines_status',
  {
    name: text('name').primaryKey(),
    /**
     * The first and last SUCCESSFUL contact; both are null together, for a
     * Machine llame has only ever failed to reach. A failure is not a contact,
     * so recording one must not make the Machine look seen.
     */
    firstContactAt: timestamptz('first_contact_at'),
    lastContactAt: timestamptz('last_contact_at'),
    lastFailureAt: timestamptz('last_failure_at'),
    lastFailureReason: text('last_failure_reason'),
    /** The protocol version the HUB spoke at that contact. */
    hubProtocolVersion: integer('hub_protocol_version').notNull(),
    /** The protocol version the daemon reported; unknown after a failure. */
    daemonProtocolVersion: integer('daemon_protocol_version'),
    daemonVersion: text('daemon_version'),
    /** The Machine's registered roots, bounded (count and length). */
    roots: jsonb('roots')
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The configuration grammar for a Machine name; a row for anything else
    // could only come from a bug, and would never match a configured Machine.
    check('machines_status_name_check', sql`${t.name} ~ '^[a-z0-9-]{1,63}$'`),
    // The closed failure vocabulary (machines-status.ts), mirrored so a typo
    // cannot enter the table through a future writer.
    check(
      'machines_status_failure_reason_check',
      sql`${t.lastFailureReason} IS NULL OR ${t.lastFailureReason} IN ('unreachable', 'host_key_mismatch', 'auth_failed', 'incompatible_version', 'session_lost')`,
    ),
    // READ: an authenticated identity only. This is the policy the spec's
    // "Requests without an authenticated identity SHALL NOT read Machine
    // status" is enforced by; `runAsPublic` (identity '') deliberately matches
    // nothing. The hub's own live push reads the row in the marked system
    // context below instead of any user's identity, because it sends the
    // instance-wide record to every connection.
    pgPolicy('machines_status_authenticated_select', {
      for: 'select',
      using: sql`current_setting('app.current_user_id', true) <> ''`,
    }),
    // WRITE, and the live push's read: the hub's own system context, marked
    // per transaction by `set_config('app.machines_system', '1', true)` in
    // MachinesStatusRepository. The marker is transaction-local, so a session
    // event and the probe job write, while a request — which never sets it —
    // cannot. It is one `for: 'all'` policy rather than per-command ones on
    // purpose: PostgreSQL also requires SELECT visibility for a WHERE-filtered
    // UPDATE or DELETE, so a writer that could not read its own row would
    // silently update nothing (observed as 0 affected rows).
    pgPolicy('machines_status_system_write', {
      for: 'all',
      using: sql`current_setting('app.machines_system', true) = '1'`,
      withCheck: sql`current_setting('app.machines_system', true) = '1'`,
    }),
  ],
).enableRLS();
