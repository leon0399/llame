import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatTemporalAnchor,
  isIanaTimeZone,
  resolveInstanceTimezone,
  resetDegenerateZoneLog,
} from './temporal-anchor';

describe('formatTemporalAnchor', () => {
  it('renders a non-UTC zone with its offset and canonical IANA identifier', () => {
    const instant = new Date('2026-08-19T14:36:00Z');
    const anchor = formatTemporalAnchor(instant, 'America/New_York');
    expect(anchor.systemTime).toBe('2026-08-19 10:36-04:00');
    expect(anchor.systemTimezone).toBe('America/New_York');
  });

  it('renders UTC with a zero offset', () => {
    const instant = new Date('2026-08-19T14:36:00Z');
    const anchor = formatTemporalAnchor(instant, 'UTC');
    expect(anchor.systemTime).toBe('2026-08-19 14:36+00:00');
    expect(anchor.systemTimezone).toBe('UTC');
  });

  it('renders a fractional-hour zone correctly (Asia/Kathmandu, +05:45)', () => {
    const instant = new Date('2026-08-19T14:36:00Z');
    const anchor = formatTemporalAnchor(instant, 'Asia/Kathmandu');
    expect(anchor.systemTime).toBe('2026-08-19 20:21+05:45');
    // ICU canonicalizes to Asia/Katmandu
    expect(anchor.systemTimezone).toBe('Asia/Katmandu');
  });

  it('returns the ICU canonical zone spelling rather than the input', () => {
    const instant = new Date('2026-01-15T12:00:00Z');
    const anchor = formatTemporalAnchor(instant, 'Asia/Kathmandu');
    expect(anchor.systemTimezone).toBe('Asia/Katmandu');
  });

  it('tracks the offset across a DST transition', () => {
    // America/New_York: EDT (-04:00) in summer, EST (-05:00) in winter
    const summer = new Date('2026-07-15T18:00:00Z');
    const winter = new Date('2026-01-15T18:00:00Z');

    const summerAnchor = formatTemporalAnchor(summer, 'America/New_York');
    const winterAnchor = formatTemporalAnchor(winter, 'America/New_York');

    expect(summerAnchor.systemTime).toContain('-04:00');
    expect(winterAnchor.systemTime).toContain('-05:00');
    // Zone identifier stays the same
    expect(summerAnchor.systemTimezone).toBe('America/New_York');
    expect(winterAnchor.systemTimezone).toBe('America/New_York');
  });
});

describe('resolveInstanceTimezone', () => {
  beforeEach(() => {
    resetDegenerateZoneLog();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a valid IANA identifier from the current environment', () => {
    const tz = resolveInstanceTimezone();
    expect(tz).toBeTruthy();
    expect(tz).not.toBe('Etc/Unknown');
    expect(isIanaTimeZone(tz)).toBe(true);
  });

  // A POSIX `TZ` such as `GMT+2` resolves to `+02:00`, which `Intl` accepts as
  // a time zone but which is not an identifier and carries no DST rule.
  it('rejects a bare UTC offset in favour of UTC', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'GMT+2';
      // Only meaningful if this host actually resolves the POSIX form to an
      // offset; where it does not, the assertion below still has to hold.
      expect(isIanaTimeZone(resolveInstanceTimezone())).toBe(true);
    } finally {
      process.env.TZ = original;
    }
  });

  it.each([
    ['an offset', '+02:00', false],
    ['a negative offset', '-05:00', false],
    ['a digit-prefixed zone', '2:00', false],
    ['an empty zone', '', false],
    ['an identifier', 'Europe/Madrid', true],
    ['UTC', 'UTC', true],
  ])('classifies %s', (_label, zone, expected) => {
    expect(isIanaTimeZone(zone)).toBe(expected);
  });

  it.each(['', 'Etc/Unknown', '+02:00'])(
    'falls back for the degenerate resolved zone %j',
    (timeZone) => {
      const actual = new Intl.DateTimeFormat().resolvedOptions();
      vi.spyOn(
        Intl.DateTimeFormat.prototype,
        'resolvedOptions',
      ).mockReturnValue({ ...actual, timeZone });
      const logger = new Logger('test');
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      expect(resolveInstanceTimezone(logger)).toBe('UTC');
      expect(resolveInstanceTimezone(logger)).toBe('UTC');
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        `Instance timezone resolved to ${String(timeZone)}; falling back to UTC. Set TZ to a valid IANA zone (e.g. Europe/Madrid), not a POSIX offset.`,
      );
    },
  );

  it('returns a resolved IANA zone without logging', () => {
    const actual = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...actual,
      timeZone: 'Pacific/Auckland',
    });
    const logger = new Logger('test');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    expect(resolveInstanceTimezone(logger)).toBe('Pacific/Auckland');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('degenerate-zone fallback', () => {
  it('renders +00:00 (UTC) for a UTC input zone', () => {
    const instant = new Date('2026-08-19T00:00:00Z');
    const anchor = formatTemporalAnchor(instant, 'UTC');
    expect(anchor.systemTime).toContain('+00:00');
    expect(anchor.systemTimezone).toBe('UTC');
  });
});
