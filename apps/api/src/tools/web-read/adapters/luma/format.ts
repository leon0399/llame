/** Local time, price, and ticket lines for a Luma event. */

export interface LumaMoney {
  cents?: number | null;
  currency?: string | null;
}

export interface LumaTicketType {
  name?: string | null;
  type?: string | null;
  cents?: number | null;
  currency?: string | null;
  is_flexible?: boolean | null;
  min_cents?: number | null;
  is_hidden?: boolean | null;
  is_disabled?: boolean | null;
  valid_start_at?: string | null;
  valid_end_at?: string | null;
}

export interface LumaTicketInfo {
  price?: LumaMoney | null;
  max_price?: LumaMoney | null;
  is_free?: boolean | null;
}

export function priceOf(
  info: LumaTicketInfo | null | undefined,
): string | undefined {
  if (info === null || info === undefined) return undefined;
  if (info.is_free === true) return 'Free';
  const cents = info.price?.cents;
  if (cents === null || cents === undefined) return undefined;
  const formatted = formatMoney(cents, info.price?.currency);
  const max = info.max_price?.cents;
  if (max === null || max === undefined || max === cents) return formatted;
  const maxCurrency = info.max_price?.currency ?? info.price?.currency;
  return `${formatted}–${formatMoney(max, maxCurrency)}`;
}

export function ticketLines(
  types: ReadonlyArray<LumaTicketType> | null | undefined,
  zone: string | null | undefined,
): Array<string> {
  if (types === null || types === undefined) return [];
  const lines: Array<string> = [];
  for (const type of types) {
    const line = ticketLine(type, zone);
    if (line !== undefined) lines.push(`- ${line}`);
  }
  return lines;
}

export function formatEventTime(
  iso: string | null | undefined,
  timeZone: string | null | undefined,
): string | undefined {
  const instant = textOrUndefined(iso);
  if (instant === undefined || Number.isNaN(Date.parse(instant)))
    return undefined;
  const zone = textOrUndefined(timeZone);
  if (zone === undefined) return instant;
  const local = localStamp(new Date(instant), zone);
  return local ?? `${instant} (${zone})`;
}

export function countOf(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return String(value);
}

export function textOrUndefined(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = oneLine(value);
  return text === '' ? undefined : text;
}

function ticketLine(
  type: LumaTicketType,
  zone: string | null | undefined,
): string | undefined {
  if (type.is_hidden === true || type.is_disabled === true) return undefined;
  const name = textOrUndefined(type.name) ?? 'Ticket';
  const window = ticketWindow(type, zone);
  const price = ticketPrice(type);
  return window === undefined
    ? `${name} — ${price}`
    : `${name} — ${price}, ${window}`;
}

function ticketPrice(type: LumaTicketType): string {
  if (type.type === 'free' || type.cents === null || type.cents === undefined) {
    return 'Free';
  }
  if (
    type.is_flexible === true &&
    type.min_cents !== null &&
    type.min_cents !== undefined
  ) {
    return `from ${formatMoney(type.min_cents, type.currency)}`;
  }
  return formatMoney(type.cents, type.currency);
}

function ticketWindow(
  type: LumaTicketType,
  zone: string | null | undefined,
): string | undefined {
  const start = formatEventTime(type.valid_start_at, zone);
  const end = formatEventTime(type.valid_end_at, zone);
  if (start !== undefined && end !== undefined) return `${start} – ${end}`;
  if (end !== undefined) return `until ${end}`;
  if (start !== undefined) return `from ${start}`;
  return undefined;
}

function formatMoney(
  cents: number,
  currency: string | null | undefined,
): string {
  const amount = cents / 100;
  const code =
    currency === null || currency === undefined
      ? ''
      : currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(code)) {
    return code === '' ? amount.toFixed(2) : `${amount.toFixed(2)} ${code}`;
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function localStamp(date: Date, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    return stampFromParts(parts, timeZone);
  } catch {
    return undefined;
  }
}

function stampFromParts(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  timeZone: string,
): string | undefined {
  const year = partValue(parts, 'year');
  const month = partValue(parts, 'month');
  const day = partValue(parts, 'day');
  const hour = partValue(parts, 'hour');
  const minute = partValue(parts, 'minute');
  const zoneName = partValue(parts, 'timeZoneName');
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    zoneName === undefined
  ) {
    return undefined;
  }
  return `${year}-${month}-${day} ${hour}:${minute} ${offsetLabel(zoneName)} (${timeZone})`;
}

function partValue(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  type: Intl.DateTimeFormatPartTypes,
): string | undefined {
  for (const part of parts) {
    if (part.type === type) return part.value;
  }
  return undefined;
}

function offsetLabel(name: string): string {
  if (name === 'GMT' || name === 'UTC') return 'UTC+00:00';
  return name.startsWith('GMT') ? `UTC${name.slice(3)}` : name;
}

export function oneLine(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}
