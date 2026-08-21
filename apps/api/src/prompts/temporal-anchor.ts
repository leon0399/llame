import { Logger } from '@nestjs/common';

export type TemporalAnchor = {
  systemTime: string;
  systemTimezone: string;
};

const UTC_ZONE = 'UTC';
const UTC_OFFSET = '+00:00';

/**
 * Does this name an IANA zone, as opposed to a bare UTC offset?
 *
 * ECMA-402 accepts an offset (`+02:00`) wherever a time zone is expected, and
 * a host with a POSIX `TZ` such as `GMT+2` resolves to exactly that. An offset
 * is not interchangeable with an identifier: it carries no daylight-saving
 * rule, so a value stamped with one renders a wrong wall-clock time for half
 * the year, and it is not the IANA identifier the temporal surfaces promise.
 *
 * The leading character is the whole test — every IANA identifier starts with
 * a letter, and every offset form starts with a sign or a digit.
 */
export function isIanaTimeZone(value: string): boolean {
  return /^[A-Za-z]/.test(value);
}

let degenerateZoneLogged = false;

/**
 * Resolves the instance's timezone from the process environment.
 *
 * Falls back to UTC when the resolved zone is absent, degenerate
 * (`Etc/Unknown`), or a bare UTC offset, and logs the condition once so a
 * misconfiguration is discoverable rather than silent. Resolved per render
 * rather than cached at module load so tests stay pure and a runtime `TZ`
 * change takes effect on restart.
 *
 * The offset case is a real host configuration, not a hypothetical: a POSIX
 * `TZ` such as `GMT+2` resolves to `+02:00`. Rejecting it here rather than at
 * each consumer is what keeps one guard in the function whose contract is "the
 * instance's IANA zone" — otherwise every surface that stamps a zone has to
 * rediscover the case, and the one that does not silently promises an IANA
 * identifier while emitting an offset.
 */
export function resolveInstanceTimezone(logger?: Logger): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!resolved || resolved === 'Etc/Unknown' || !isIanaTimeZone(resolved)) {
    if (!degenerateZoneLogged) {
      degenerateZoneLogged = true;
      (logger ?? new Logger('TemporalAnchor')).warn(
        `Instance timezone resolved to ${String(resolved)}; falling back to UTC. Set TZ to a valid IANA zone (e.g. Europe/Madrid), not a POSIX offset.`,
      );
    }
    return UTC_ZONE;
  }
  return resolved;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * One formatter per zone, reused for the process's life.
 *
 * Construction is the expensive part of `Intl` (locale and tz-data
 * resolution); formatting with a built one is cheap. Every user turn's
 * persisted timestamp re-renders on every request, so a conversation of n
 * turns would otherwise construct O(n^2) formatters over its life. The map is
 * self-bounding — there are only so many IANA zones — and a formatter is
 * stateless, so reuse cannot leak one call's result into another's.
 */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/**
 * Formats a temporal anchor from a single `Intl.DateTimeFormat` result so the
 * offset and the zone identifier cannot disagree.
 *
 * Pure function: the timezone is a parameter, not read from the environment.
 * The composition boundary (`resolveInstanceTimezone`) decides which zone to
 * pass; #454 will pass a second zone without mutating `process.env.TZ`.
 */
export function formatTemporalAnchor(
  instant: Date,
  timeZone: string,
): TemporalAnchor {
  const formatter = formatterFor(timeZone);

  const parts = formatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');

  const rawOffset = get('timeZoneName');
  // `timeZoneName: 'longOffset'` yields `GMT+05:45` or bare `GMT` for UTC.
  const offset =
    rawOffset === 'GMT' ? UTC_OFFSET : rawOffset.replace(/^GMT/, '');

  const canonicalZone = formatter.resolvedOptions().timeZone;

  return {
    systemTime: `${year}-${month}-${day} ${hour}:${minute}${offset}`,
    systemTimezone: canonicalZone,
  };
}

/** Reset the once-log latch (test support only). */
export function resetDegenerateZoneLog(): void {
  degenerateZoneLogged = false;
}
