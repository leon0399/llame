import { timestamp } from 'drizzle-orm/pg-core';

type TimestampOptions = Parameters<typeof timestamp>[1];

/**
 * The one way to declare a timestamp column.
 *
 * Drizzle's stock `timestamp()` is Postgres `timestamp without time zone`: the
 * stored value carries no UTC anchor, so what it means depends on the session
 * zone of whichever process wrote it. That is invisible while one writer exists
 * and becomes an ordering bug the moment a second one does, which the roadmap's
 * Personal Realm synchronization makes concrete.
 *
 * Passing `{ withTimezone: true }` by hand at every column is the same thing one
 * forgotten option away from wrong, and two columns in `schema/auth.ts` had
 * already forgotten it. This wrapper takes the option out of the decision.
 * `anti-slop/require-timestamptz-column` enforces that schema files call this
 * instead of pg-core's `timestamp`.
 *
 * Everything else stays caller-controlled: `mode` decides whether the column
 * reads back as a `Date` or a string, and existing columns differ deliberately.
 *
 * NOT decided here: `precision`. Postgres stores microseconds by default while
 * a JavaScript `Date` holds milliseconds, so a `Date` round-tripped through a
 * keyset cursor can compare unequal to the row it came from. `knowledge_spaces`
 * is the only table that pins `precision: 3` today, and it is also the only one
 * with a `Date`-valued cursor. Making that the default would alter every
 * existing timestamp column, so it stays an explicit per-column choice until
 * that migration is taken deliberately.
 */
export function timestamptz(name: string, options?: TimestampOptions) {
  return timestamp(name, { ...options, withTimezone: true });
}
