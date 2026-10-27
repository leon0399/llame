import { type EngineRequest } from './chain';

export type SiteFilters = {
  readonly query: string;
  include: Array<string>;
  exclude: Array<string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days before the request date that each `recency` value covers. */
const RECENCY_DAYS: Readonly<
  Record<NonNullable<EngineRequest['recency']>, number>
> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/** The instant a `recency` window starts at, counted from `now`. */
export function recencyStart(
  recency: NonNullable<EngineRequest['recency']>,
  now: number = Date.now(),
): Date {
  return new Date(now - RECENCY_DAYS[recency] * DAY_MS);
}

/**
 * The `YYYY-MM-DD` date a `recency` window starts at, for a vendor that takes a
 * date instead of a named freshness period.
 */
export function recencyDate(
  recency: NonNullable<EngineRequest['recency']>,
): string {
  return recencyStart(recency).toISOString().slice(0, 10);
}

/** Remove whitespace-delimited site operators while preserving their hosts. */
export function splitSiteFilters(query: string): SiteFilters {
  const include: Array<string> = [];
  const exclude: Array<string> = [];
  const remaining = query
    .trim()
    .split(/\s+/)
    .filter((token) => {
      const match = /^(-?)site:(\S+)/iu.exec(token);
      if (match === null) return true;
      const host = match[2];
      if (/^["'(),]|["'(),]$/u.test(host)) return true;
      (match[1] === '-' ? exclude : include).push(host);
      return false;
    });
  return { query: remaining.join(' '), include, exclude };
}
