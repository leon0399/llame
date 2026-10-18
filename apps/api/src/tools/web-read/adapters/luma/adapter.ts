import { z } from 'zod';

import type { LumaWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebRequestInit } from '../../http-client';
import {
  parseJsonBody,
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';
import {
  countOf,
  formatEventTime,
  oneLine,
  priceOf,
  textOrUndefined,
  ticketLines,
} from './format';
import { MIRROR, renderMirror, type MirrorNode } from './mirror';

/** `GET /url?url={slug}` is the keyless JSON the event page embeds, and its
 *  `kind` distinguishes an event from a calendar, place, or category. */
export const LUMA_API_ORIGIN = 'https://api.lu.ma';
const CANONICAL_ORIGIN = 'https://luma.com';
const JSON_INIT: WebRequestInit = { accept: 'application/json' };
const HOSTS = new Set(['luma.com', 'www.luma.com', 'lu.ma', 'www.lu.ma']);
/** One public slug. Dots occur (`maxima.ai`); slashes do not. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/u;
const SAFE_URL = /^https?:\/\/[^\s)]+$/u;

const HOST = z.object({
  name: z.string().nullish(),
  username: z.string().nullish(),
});
const GEO = z.object({
  mode: z.string().nullish(),
  address: z.string().nullish(),
  full_address: z.string().nullish(),
  city: z.string().nullish(),
  city_state: z.string().nullish(),
  region: z.string().nullish(),
  country: z.string().nullish(),
});
const PRICE = z.object({
  cents: z.number().nullish(),
  currency: z.string().nullish(),
});
const TICKET_TYPE = z.object({
  name: z.string().nullish(),
  cents: z.number().nullish(),
  currency: z.string().nullish(),
  is_hidden: z.boolean().nullish(),
  is_disabled: z.boolean().nullish(),
  is_flexible: z.boolean().nullish(),
  min_cents: z.number().nullish(),
  type: z.string().nullish(),
  valid_start_at: z.string().nullish(),
  valid_end_at: z.string().nullish(),
});
const TICKET_INFO = z.object({
  is_free: z.boolean().nullish(),
  is_sold_out: z.boolean().nullish(),
  require_approval: z.boolean().nullish(),
  spots_remaining: z.number().nullish(),
  price: PRICE.nullish(),
  max_price: PRICE.nullish(),
});
const EVENT = z.object({
  name: z.string().min(1),
  url: z.string().nullish(),
  start_at: z.string().nullish(),
  end_at: z.string().nullish(),
  timezone: z.string().nullish(),
  cover_url: z.string().nullish(),
  social_image_url: z.string().nullish(),
  location_type: z.string().nullish(),
  visibility: z.string().nullish(),
  geo_address_visibility: z.string().nullish(),
  geo_address_info: GEO.nullish(),
  virtual_info: z
    .object({
      has_access: z.boolean().nullish(),
      raw_join_url: z.string().nullish(),
    })
    .nullish(),
});

/** Anything other than `kind: "event"` fails this schema and falls through. */
const EVENT_PAYLOAD = z.object({
  kind: z.literal('event'),
  data: z.object({
    event: EVENT,
    hosts: z.array(HOST).nullish(),
    calendar: z
      .object({
        name: z.string().nullish(),
        slug: z.string().nullish(),
      })
      .nullish(),
    description_mirror: MIRROR.nullish(),
    ticket_info: TICKET_INFO.nullish(),
    ticket_types: z.array(TICKET_TYPE).nullish(),
    registration_availability: z.string().nullish(),
    sold_out: z.boolean().nullish(),
    waitlist_active: z.boolean().nullish(),
    guest_count: z.number().nullish(),
  }),
});

type EventPayload = z.infer<typeof EVENT_PAYLOAD>;
type EventRecord = EventPayload['data']['event'];
type Geo = z.infer<typeof GEO>;
type Host = z.infer<typeof HOST>;
type Calendar = NonNullable<EventPayload['data']['calendar']>;

/** Matches a single-segment `luma.com` or `lu.ma` slug, including `www`. */
export function parseLumaUrl(source: URL): string | undefined {
  if (source.protocol !== 'https:' || !HOSTS.has(source.host)) return undefined;
  const segments = source.pathname.split('/').filter((part) => part.length > 0);
  if (segments.length !== 1) return undefined;
  const raw = segments[0];
  if (raw === undefined) return undefined;
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  return SLUG.test(slug) ? slug : undefined;
}

/** Creates the native Luma adapter. */
export function createLumaAdapter(
  config: LumaWebAdapterConfig,
  options: { readonly origin?: string } = {},
): WebAdapter {
  const origin = options.origin ?? LUMA_API_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseLumaUrl(source) !== undefined,
    read: (source, io) => readEvent(source, io, origin),
  };
}

async function readEvent(
  source: URL,
  io: WebAdapterIo,
  origin: string,
): Promise<WebAdapterOutcome> {
  const slug = parseLumaUrl(source);
  if (slug === undefined) return { kind: 'failed', failure: 'parse' };
  const fetched = await io.fetch(requestUrl(origin, slug), JSON_INIT);
  if ('type' in fetched) return primaryFailure(fetched);
  // An admitted redirect may leave api.lu.ma; only Luma's answer is an event.
  if (new URL(fetched.finalUrl).origin !== origin) {
    return { kind: 'failed', failure: 'status' };
  }
  const payload = parseJsonBody(fetched.body, EVENT_PAYLOAD);
  if (payload === undefined) return { kind: 'failed', failure: 'parse' };
  return {
    kind: 'rendered',
    content: renderEvent(payload, slug),
    mediaType: 'text/markdown',
    notes: [],
  };
}

function requestUrl(origin: string, slug: string): string {
  return `${origin}/url?url=${encodeURIComponent(slug)}`;
}

function renderEvent(payload: EventPayload, slug: string): string {
  const lines = [`# ${oneLine(payload.data.event.name)}`, ''];
  appendFacts(lines, payload);
  appendOffer(lines, payload);
  lines.push(`URL: ${canonicalUrl(payload.data.event.url, slug)}`);
  appendDescription(lines, payload.data.description_mirror);
  return lines.join('\n');
}

function appendFacts(lines: Array<string>, payload: EventPayload): void {
  const { event } = payload.data;
  pushField(lines, 'Status', statusOf(payload));
  pushField(lines, 'Visibility', visibilityOf(event.visibility));
  pushField(lines, 'Start', formatEventTime(event.start_at, event.timezone));
  pushField(lines, 'End', formatEventTime(event.end_at, event.timezone));
  for (const line of locationLines(event)) lines.push(line);
  pushField(lines, 'Hosts', hostsOf(payload.data.hosts));
  pushField(lines, 'Organizer', organizerOf(payload.data.calendar));
  pushField(
    lines,
    'Registration',
    textOrUndefined(payload.data.registration_availability),
  );
  if (payload.data.ticket_info?.require_approval === true) {
    lines.push('Approval: required');
  }
}

function appendOffer(lines: Array<string>, payload: EventPayload): void {
  const { event } = payload.data;
  pushField(lines, 'Price', priceOf(payload.data.ticket_info));
  const tickets = ticketLines(payload.data.ticket_types, event.timezone);
  if (tickets.length > 0) lines.push('Tickets:', ...tickets);
  pushField(
    lines,
    'Spots remaining',
    countOf(payload.data.ticket_info?.spots_remaining),
  );
  pushField(lines, 'Guests', countOf(payload.data.guest_count));
  pushField(lines, 'Cover', coverOf(event));
}

function appendDescription(
  lines: Array<string>,
  mirror: MirrorNode | null | undefined,
): void {
  const description = renderMirror(mirror);
  if (description !== '') lines.push('', description);
}

function pushField(
  lines: Array<string>,
  label: string,
  value: string | undefined,
): void {
  if (value !== undefined) lines.push(`${label}: ${value}`);
}

function statusOf(payload: EventPayload): string | undefined {
  const end = payload.data.event.end_at;
  if (hasEnded(end)) return 'ended';
  const parts: Array<string> = [];
  if (isSoldOut(payload)) parts.push('sold out');
  if (isWaitlist(payload)) parts.push('waitlist');
  return parts.length === 0 ? undefined : parts.join(', ');
}

function hasEnded(iso: string | null | undefined): boolean {
  if (iso === null || iso === undefined) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && time < Date.now();
}

function isSoldOut(payload: EventPayload): boolean {
  return (
    payload.data.sold_out === true ||
    payload.data.ticket_info?.is_sold_out === true ||
    payload.data.registration_availability === 'sold-out'
  );
}

function isWaitlist(payload: EventPayload): boolean {
  return (
    payload.data.waitlist_active === true ||
    payload.data.registration_availability === 'waitlist'
  );
}

function visibilityOf(
  visibility: string | null | undefined,
): string | undefined {
  const text = textOrUndefined(visibility);
  return text === undefined || text === 'public' ? undefined : text;
}

function locationLines(event: EventRecord): Array<string> {
  const online = onlineLocation(event);
  const place = placeOf(event.geo_address_info, event.geo_address_visibility);
  const lines: Array<string> = [];
  if (online !== undefined) lines.push(`Location: ${online}`);
  if (place !== undefined) {
    lines.push(`${online === undefined ? 'Location' : 'Venue'}: ${place}`);
  } else if (online === undefined && event.location_type === 'offline') {
    lines.push('Location: In person');
  }
  return lines;
}

function onlineLocation(event: EventRecord): string | undefined {
  const join = joinUrl(event.virtual_info);
  const type = event.location_type;
  const online =
    type === 'online' ||
    type === 'virtual' ||
    type === 'zoom' ||
    join !== undefined;
  if (!online) return undefined;
  return join === undefined ? 'Online' : `Online — ${join}`;
}

function joinUrl(info: EventRecord['virtual_info']): string | undefined {
  // A missing grant is the anonymous payload. Only `has_access: true` is public.
  if (info === null || info === undefined || info.has_access !== true) {
    return undefined;
  }
  return httpUrl(info.raw_join_url);
}

function modeMissing(mode: string | null | undefined): boolean {
  return mode === null || mode === undefined;
}

function placeOf(
  geo: Geo | null | undefined,
  visibility: string | null | undefined,
): string | undefined {
  if (geo === null || geo === undefined) return undefined;
  if (
    geo.mode === 'shown' ||
    (modeMissing(geo.mode) && visibility === 'public')
  ) {
    return shownPlace(geo);
  }
  const city = cityOf(geo);
  if (city === undefined) return undefined;
  return geo.mode === 'obfuscated'
    ? `${city} (street address shared with guests)`
    : city;
}

function shownPlace(geo: Geo): string | undefined {
  const full = textOrUndefined(geo.full_address);
  if (full !== undefined) return full;
  const address = textOrUndefined(geo.address);
  const city = cityOf(geo);
  if (address !== undefined && city !== undefined) return `${address}, ${city}`;
  return address ?? city;
}

function cityOf(geo: Geo): string | undefined {
  const cityState = textOrUndefined(geo.city_state);
  if (cityState !== undefined) return cityState;
  const parts: Array<string> = [];
  for (const part of [geo.city, geo.region, geo.country]) {
    const text = textOrUndefined(part);
    if (text !== undefined) parts.push(text);
  }
  return parts.length === 0 ? undefined : parts.join(', ');
}

function hostsOf(
  hosts: ReadonlyArray<Host> | null | undefined,
): string | undefined {
  if (hosts === null || hosts === undefined) return undefined;
  const names: Array<string> = [];
  for (const host of hosts) {
    const label = hostLabel(host.name, host.username);
    if (label !== undefined) names.push(label);
  }
  return names.length === 0 ? undefined : names.join(', ');
}

function organizerOf(
  calendar: Calendar | null | undefined,
): string | undefined {
  if (calendar === null || calendar === undefined) return undefined;
  return hostLabel(calendar.name, calendar.slug);
}

function hostLabel(
  name: string | null | undefined,
  slug: string | null | undefined,
): string | undefined {
  const label = textOrUndefined(name);
  const link = slugLink(slug);
  if (label !== undefined && link !== undefined) return `${label} (${link})`;
  return label ?? link;
}

function slugLink(slug: string | null | undefined): string | undefined {
  if (slug === null || slug === undefined || !SLUG.test(slug)) return undefined;
  return `${CANONICAL_ORIGIN}/${slug}`;
}

function coverOf(event: EventRecord): string | undefined {
  return httpUrl(event.cover_url) ?? httpUrl(event.social_image_url);
}

function httpUrl(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || !SAFE_URL.test(value)) {
    return undefined;
  }
  return value;
}

function canonicalUrl(
  eventUrl: string | null | undefined,
  slug: string,
): string {
  const path =
    eventUrl !== null && eventUrl !== undefined && SLUG.test(eventUrl)
      ? eventUrl
      : slug;
  return `${CANONICAL_ORIGIN}/${path}`;
}
