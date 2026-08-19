import { Logger } from '@nestjs/common';

export type TemporalAnchor = {
  systemTime: string;
  systemTimezone: string;
};

const UTC_ZONE = 'UTC';
const UTC_OFFSET = '+00:00';

let degenerateZoneLogged = false;

/**
 * Resolves the instance's timezone from the process environment.
 *
 * Falls back to UTC when the resolved zone is absent or degenerate
 * (`Etc/Unknown`), and logs the condition once so a misconfiguration is
 * discoverable rather than silent. Resolved per render rather than cached at
 * module load so tests stay pure and a runtime `TZ` change takes effect on
 * restart.
 */
export function resolveInstanceTimezone(logger?: Logger): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!resolved || resolved === 'Etc/Unknown') {
    if (!degenerateZoneLogged) {
      degenerateZoneLogged = true;
      (logger ?? new Logger('TemporalAnchor')).warn(
        `Instance timezone resolved to ${String(resolved)}; falling back to UTC. Set TZ to a valid IANA zone.`,
      );
    }
    return UTC_ZONE;
  }
  return resolved;
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
