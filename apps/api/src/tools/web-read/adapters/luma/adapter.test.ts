import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebFetchFailure, WebResponse } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createLumaAdapter, LUMA_API_ORIGIN } from './adapter';

const adapter = createLumaAdapter(
  { id: 'luma', use: 'luma' },
  { origin: API_ORIGIN },
);
const READ_AT = new Date('2026-10-18T12:00:00.000Z');

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function jsonBody(body: string, finalUrl = `${API_ORIGIN}/url`): WebResponse {
  return { finalUrl, contentType: 'application/json', body };
}

function eventUrl(slug: string, origin = API_ORIGIN): string {
  return `${origin}/url?url=${encodeURIComponent(slug)}`;
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

function rendered(
  outcome: Awaited<ReturnType<typeof read>>['outcome'],
): string {
  expect(outcome.kind).toBe('rendered');
  if (outcome.kind !== 'rendered') throw new Error('expected render');
  return outcome.content;
}

describe('Luma adapter claim', () => {
  it.each([
    'https://luma.com/apawn7qt',
    'https://luma.com/apawn7qt/',
    'https://luma.com/apawn7qt?utm_source=x',
    'https://www.luma.com/apawn7qt',
    'https://lu.ma/apawn7qt',
    'https://www.lu.ma/apawn7qt/',
    'https://luma.com/granola-gtm-hackathon',
    'https://luma.com/maxima.ai',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://luma.com/apawn7qt',
    'https://luma.com:8443/apawn7qt',
    'https://luma.com/',
    'https://luma.com/apawn7qt/register',
    'https://luma.com/user/diapant',
    'https://images.lumacdn.com/uploads/x.png',
    'https://api.lu.ma/url',
    'https://luma.com/.hidden',
    'https://luma.com/a%2Fb',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Luma adapter read', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(READ_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the recorded apawn7qt event from the public URL API', async () => {
    const { outcome, requests } = await read('https://lu.ma/apawn7qt?utm=x', [
      [eventUrl('apawn7qt'), jsonBody(fixture('apawn7qt.json'))],
    ]);

    expect(requests).toStrictEqual([
      { url: eventUrl('apawn7qt'), init: { accept: 'application/json' } },
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: APAWN7QT,
    });
    const content = rendered(outcome);
    expect(content).not.toContain('acct_');
    expect(content).not.toContain('Jelena Duric');

    // The ProseMirror schema is built on the first parse in this file, so this
    // read is what a mutation of those attribute fields has to survive.
    const described = await contentFor(
      'attrs1',
      eventDocument(
        { name: 'Attrs', url: 'attrs1' },
        { description_mirror: ATTRS_MIRROR },
      ),
    );
    expect(described).toContain('## Section');
    expect(described).toContain('![](https://images.lumacdn.com/chart.png)');
  });

  it('asks api.lu.ma when no test origin is configured', async () => {
    const live = createLumaAdapter({ id: 'luma', use: 'luma' });
    const url = eventUrl('apawn7qt', LUMA_API_ORIGIN);
    const run = scriptedIo(
      new Map([
        [url, [jsonBody(fixture('apawn7qt.json'), `${LUMA_API_ORIGIN}/url`)]],
      ]),
    );

    const outcome = await live.read(
      new URL('https://luma.com/apawn7qt/'),
      run.io,
    );

    expect(run.requests.map(({ url: requested }) => requested)).toStrictEqual([
      url,
    ]);
    expect(outcome.kind).toBe('rendered');
  });

  it('renders a recorded guests-only venue as the city, and a free approval ticket', async () => {
    const { outcome } = await read('https://luma.com/xfmswy2s', [
      [eventUrl('xfmswy2s'), jsonBody(fixture('xfmswy2s.json'))],
    ]);
    const content = rendered(outcome);

    expect(content).toContain('# Solidcore x Maxima: Pilates Pop-up');
    expect(content).toContain(
      'Start: 2026-10-18 10:00 UTC-07:00 (America/Los_Angeles)',
    );
    expect(content).toContain(
      'End: 2026-10-18 11:00 UTC-07:00 (America/Los_Angeles)',
    );
    expect(content).toContain(
      'Location: Mountain View, CA (street address shared with guests)',
    );
    expect(content).toContain(
      'Hosts: Juliana Ko (https://luma.com/julianako), Sohini Chowdhury (https://luma.com/sohini)',
    );
    expect(content).toContain(
      'Organizer: Maxima AI (https://luma.com/maxima.ai)',
    );
    expect(content).toContain('Registration: open');
    expect(content).toContain('Approval: required');
    expect(content).toContain('Price: Free');
    expect(content).toContain('- Standard — Free');
    expect(content).toContain('Spots remaining: 1');
    expect(content).toContain('Guests: 0');
    expect(content).not.toContain('Visibility:');
    expect(content).not.toContain('Status:');
  });

  it('renders a recorded list, and sold-out waitlist status, without a street', async () => {
    const { outcome } = await read('https://luma.com/granola-gtm-hackathon', [
      [
        eventUrl('granola-gtm-hackathon'),
        jsonBody(fixture('granola-gtm-hackathon.json')),
      ],
    ]);
    const content = rendered(outcome);

    expect(content).toContain('Status: sold out, waitlist');
    expect(content).toContain('Registration: waitlist');
    expect(content).toContain(
      'Location: San Francisco, CA (street address shared with guests)',
    );
    expect(content).toContain('**GTM and Marketing operators**');
    expect(content).toContain('- Doors open at **5.30pm**');
    expect(content).toContain('\n\n---\n\n');
  });

  it('marks a recorded event ended once its end time has passed', async () => {
    vi.setSystemTime(new Date('2026-10-18T19:00:00.000Z'));
    const { outcome } = await read('https://luma.com/xfmswy2s', [
      [eventUrl('xfmswy2s'), jsonBody(fixture('xfmswy2s.json'))],
    ]);

    const content = rendered(outcome);
    expect(content).toContain('Status: ended');
    expect(content).toContain('# Solidcore x Maxima: Pilates Pop-up');
    expect(content).toContain('URL: https://luma.com/xfmswy2s');
  });

  it('omits a street address that arrived with an obfuscated venue', async () => {
    const payload = eventDocument({
      name: 'Hidden venue',
      location_type: 'offline',
      geo_address_visibility: 'guests-only',
      geo_address_info: {
        mode: 'obfuscated',
        city_state: 'Madrid, Spain',
        full_address: 'Secret Street 1, Madrid',
      },
    });
    const { outcome } = await read('https://luma.com/hidden1', [
      [eventUrl('hidden1'), response(payload)],
    ]);
    const content = rendered(outcome);

    expect(content).toContain(
      'Location: Madrid, Spain (street address shared with guests)',
    );
    expect(content).not.toContain('Secret Street');
  });

  it('renders an online event with a join URL only when access is granted', async () => {
    const open = await read('https://luma.com/online1', [
      [
        eventUrl('online1'),
        response(
          eventDocument({
            name: 'Online talk',
            url: 'online1',
            location_type: 'online',
            virtual_info: {
              has_access: true,
              raw_join_url: 'https://example.com/join',
            },
          }),
        ),
      ],
    ]);
    expect(rendered(open.outcome)).toContain(
      'Location: Online — https://example.com/join',
    );

    const closed = await read('https://luma.com/online1', [
      [
        eventUrl('online1'),
        response(
          eventDocument({
            name: 'Online talk',
            url: 'online1',
            location_type: 'online',
            virtual_info: {
              has_access: false,
              raw_join_url: 'https://example.com/secret',
            },
          }),
        ),
      ],
    ]);
    const content = rendered(closed.outcome);
    expect(content).toContain('Location: Online');
    expect(content).not.toContain('example.com/secret');
  });

  it('omits fields the payload does not carry', async () => {
    const { outcome } = await read('https://luma.com/bare1', [
      [
        eventUrl('bare1'),
        response(eventDocument({ name: 'Bare event', url: 'bare1' })),
      ],
    ]);

    expect(rendered(outcome)).toBe(
      ['# Bare event', '', 'URL: https://luma.com/bare1'].join('\n'),
    );
  });

  it('converts nested lists, breaks, images, and quotes in the description', async () => {
    const { outcome } = await read('https://luma.com/rich1', [
      [
        eventUrl('rich1'),
        response(
          eventDocument(
            { name: 'Rich', url: 'rich1' },
            { description_mirror: RICH_MIRROR },
          ),
        ),
      ],
    ]);

    expect(rendered(outcome)).toContain(
      [
        '- Parent',
        '  - Child',
        '',
        '1. First',
        '2. Second',
        '',
        'Line one  ',
        'line two',
        '',
        '> A quote',
        '',
        '```',
        'code',
        '```',
        '',
        '![Chart](https://images.lumacdn.com/chart.png)',
      ].join('\n'),
    );
    expect(rendered(outcome)).not.toContain('blob:');
    expect(rendered(outcome)).not.toContain('Stryker');
  });

  it('keeps an event running when it ends at the current instant', async () => {
    const exact = await contentFor(
      'ends-now',
      eventDocument({ name: 'Ends now', end_at: READ_AT.toISOString() }),
    );
    expect(exact).not.toContain('Status:');

    const earlier = await contentFor(
      'ended-ms',
      eventDocument({
        name: 'Ended',
        end_at: new Date(READ_AT.getTime() - 1).toISOString(),
      }),
    );
    expect(earlier).toContain('Status: ended');

    const invalid = await contentFor(
      'bad-end',
      eventDocument({ name: 'Bad end', end_at: 'not-a-date' }),
    );
    expect(invalid).not.toContain('Status:');
  });

  it('reports sold out from any one of the three signals', async () => {
    const flag = await contentFor(
      'sold-flag',
      eventDocument({ name: 'Flag' }, { sold_out: true }),
    );
    expect(flag).toContain('Status: sold out');

    const ticket = await contentFor(
      'sold-ticket',
      eventDocument({ name: 'Ticket' }, { ticket_info: { is_sold_out: true } }),
    );
    expect(ticket).toContain('Status: sold out');

    const registration = await contentFor(
      'sold-reg',
      eventDocument(
        { name: 'Registration' },
        { registration_availability: 'sold-out' },
      ),
    );
    expect(registration).toContain('Status: sold out');
    expect(registration).toContain('Registration: sold-out');
  });

  it('reports a waitlist from the flag or the registration state', async () => {
    const flag = await contentFor(
      'wait-flag',
      eventDocument({ name: 'Flag' }, { waitlist_active: true }),
    );
    expect(flag).toContain('Status: waitlist');

    const registration = await contentFor(
      'wait-reg',
      eventDocument(
        { name: 'Registration' },
        { registration_availability: 'waitlist' },
      ),
    );
    expect(registration).toContain('Status: waitlist');
  });

  it('omits public visibility and a blank one', async () => {
    const pub = await contentFor(
      'vis-pub',
      eventDocument({ name: 'Public', visibility: 'public' }),
    );
    expect(pub).not.toContain('Visibility:');

    const blank = await contentFor(
      'vis-blank',
      eventDocument({ name: 'Blank', visibility: '   ' }),
    );
    expect(blank).not.toContain('Visibility:');
  });

  it('names a hybrid event venue and an offline event with no address', async () => {
    const hybrid = await contentFor(
      'hybrid1',
      eventDocument({
        name: 'Hybrid',
        location_type: 'offline',
        geo_address_visibility: 'public',
        geo_address_info: {
          mode: 'shown',
          full_address: '1 Main St, Madrid',
        },
        virtual_info: {
          has_access: true,
          raw_join_url: 'https://example.com/join',
        },
      }),
    );
    expect(hybrid).toContain('Location: Online — https://example.com/join');
    expect(hybrid).toContain('Venue: 1 Main St, Madrid');
    expect(hybrid).not.toContain('In person');

    const room = await contentFor(
      'room1',
      eventDocument({ name: 'Room', location_type: 'offline' }),
    );
    expect(room).toContain('Location: In person');
    expect(room).not.toContain('Online');
  });

  it('treats virtual, zoom, and a granted join URL as online', async () => {
    const virtual = await contentFor(
      'virtual1',
      eventDocument({ name: 'Virtual', location_type: 'virtual' }),
    );
    expect(line(virtual, 'Location:')).toBe('Location: Online');

    const zoom = await contentFor(
      'zoom1',
      eventDocument({ name: 'Zoom', location_type: 'zoom' }),
    );
    expect(line(zoom, 'Location:')).toBe('Location: Online');

    const joined = await contentFor(
      'joined1',
      eventDocument({
        name: 'Joined',
        location_type: 'offline',
        virtual_info: {
          has_access: true,
          raw_join_url: 'https://example.com/room',
        },
      }),
    );
    expect(line(joined, 'Location:')).toBe(
      'Location: Online — https://example.com/room',
    );
    expect(joined).not.toContain('In person');
  });

  it('shows a public address when the geo mode is missing, and withholds it otherwise', async () => {
    const missing = await contentFor(
      'mode-null',
      eventDocument({
        name: 'Missing mode',
        geo_address_visibility: 'public',
        geo_address_info: {
          mode: null,
          full_address: '9 Public St',
          city: 'Madrid',
        },
      }),
    );
    expect(line(missing, 'Location:')).toBe('Location: 9 Public St');

    const absent = await contentFor(
      'mode-absent',
      eventDocument({
        name: 'Absent mode',
        geo_address_visibility: 'public',
        geo_address_info: { full_address: '8 Public St', city: 'Madrid' },
      }),
    );
    expect(line(absent, 'Location:')).toBe('Location: 8 Public St');

    const privateMode = await contentFor(
      'mode-private',
      eventDocument({
        name: 'Private mode',
        geo_address_visibility: 'private',
        geo_address_info: {
          mode: null,
          full_address: 'Secret 2',
          city: 'Madrid',
          country: 'Spain',
        },
      }),
    );
    expect(line(privateMode, 'Location:')).toBe('Location: Madrid, Spain');

    const partial = await contentFor(
      'mode-partial',
      eventDocument({
        name: 'Partial',
        geo_address_visibility: 'public',
        geo_address_info: {
          mode: 'partial',
          full_address: 'Hidden 3',
          city: 'Madrid',
          region: 'Community of Madrid',
          country: 'Spain',
        },
      }),
    );
    expect(line(partial, 'Location:')).toBe(
      'Location: Madrid, Community of Madrid, Spain',
    );
  });

  it('formats a shown venue from the pieces the payload actually carries', async () => {
    const both = await contentFor(
      'addr-both',
      eventDocument({
        name: 'Both',
        geo_address_info: {
          mode: 'shown',
          address: '1 Main',
          city: 'Madrid',
          country: 'Spain',
        },
      }),
    );
    expect(line(both, 'Location:')).toBe('Location: 1 Main, Madrid, Spain');

    const street = await contentFor(
      'addr-street',
      eventDocument({
        name: 'Street',
        geo_address_info: { mode: 'shown', address: '1 Main' },
      }),
    );
    expect(line(street, 'Location:')).toBe('Location: 1 Main');

    const city = await contentFor(
      'addr-city',
      eventDocument({
        name: 'City',
        geo_address_info: { mode: 'shown', city_state: 'Madrid, Spain' },
      }),
    );
    expect(line(city, 'Location:')).toBe('Location: Madrid, Spain');

    const empty = await contentFor(
      'addr-empty',
      eventDocument({
        name: 'Empty',
        geo_address_info: { mode: 'obfuscated', full_address: 'Secret' },
      }),
    );
    expect(empty).not.toContain('Location:');
    expect(empty).not.toContain('Secret');
  });

  it('links a host or organizer that has only a name or only a slug', async () => {
    const content = await contentFor(
      'hosts1',
      eventDocument(
        { name: 'Hosts', url: 'not a slug' },
        {
          hosts: [{ name: 'Ada' }, { username: 'grace' }, { name: '   ' }],
          calendar: { slug: 'org-slug' },
          guest_count: null,
        },
      ),
    );
    expect(line(content, 'Hosts:')).toBe('Hosts: Ada, https://luma.com/grace');
    expect(line(content, 'Organizer:')).toBe(
      'Organizer: https://luma.com/org-slug',
    );
    expect(line(content, 'URL:')).toBe('URL: https://luma.com/hosts1');
    expect(content).not.toContain('Guests:');

    const named = await contentFor(
      'canon1',
      eventDocument({ name: 'Canon', url: 'canonical-slug' }),
    );
    expect(line(named, 'URL:')).toBe('URL: https://luma.com/canonical-slug');

    const none = await contentFor(
      'no-hosts',
      eventDocument({ name: '  Spaced   title  ' }, { hosts: [] }),
    );
    expect(none.startsWith('# Spaced title')).toBe(true);
    expect(none).not.toContain('Hosts:');
  });

  it('collapses a price range only when the bounds differ, and formats odd currencies', async () => {
    const same = await contentFor(
      'price-same',
      eventDocument(
        { name: 'Same' },
        {
          ticket_info: {
            is_free: false,
            price: { cents: 1000, currency: 'eur' },
            max_price: { cents: 1000, currency: 'eur' },
          },
        },
      ),
    );
    expect(line(same, 'Price:')).toBe('Price: €10.00');

    const open = await contentFor(
      'price-open',
      eventDocument(
        { name: 'Open' },
        {
          ticket_info: {
            price: { cents: 1000, currency: 'usd' },
            max_price: { cents: 2000, currency: null },
          },
        },
      ),
    );
    expect(line(open, 'Price:')).toBe('Price: $10.00–$20.00');

    const bare = await contentFor(
      'price-bare',
      eventDocument(
        { name: 'Bare' },
        { ticket_info: { price: { cents: 250, currency: null } } },
      ),
    );
    expect(line(bare, 'Price:')).toBe('Price: 2.50');

    const padded = await contentFor(
      'price-pad',
      eventDocument(
        { name: 'Padded' },
        { ticket_info: { price: { cents: 250, currency: ' usd ' } } },
      ),
    );
    expect(line(padded, 'Price:')).toBe('Price: $2.50');

    const short = await contentFor(
      'price-short',
      eventDocument(
        { name: 'Short' },
        { ticket_info: { price: { cents: 250, currency: 'US' } } },
      ),
    );
    expect(line(short, 'Price:')).toBe('Price: 2.50 US');

    const prefixed = await contentFor(
      'price-pre',
      eventDocument(
        { name: 'Prefixed' },
        { ticket_info: { price: { cents: 250, currency: '12USD' } } },
      ),
    );
    expect(line(prefixed, 'Price:')).toBe('Price: 2.50 12USD');

    const suffixed = await contentFor(
      'price-suf',
      eventDocument(
        { name: 'Suffixed' },
        { ticket_info: { price: { cents: 250, currency: 'USDXXX' } } },
      ),
    );
    expect(line(suffixed, 'Price:')).toBe('Price: 2.50 USDXXX');

    const NumberFormat = Intl.NumberFormat;
    const RejectingFormat = class extends NumberFormat {
      constructor(
        locales?: Intl.LocalesArgument,
        options?: Intl.NumberFormatOptions,
      ) {
        if (options?.currency === 'ZZZ') {
          throw new RangeError('unsupported currency');
        }
        super(locales, options);
      }
    };
    vi.spyOn(Intl, 'NumberFormat').mockImplementation(RejectingFormat);
    try {
      const unknown = await contentFor(
        'price-zzz',
        eventDocument(
          { name: 'Unknown' },
          { ticket_info: { price: { cents: 250, currency: 'ZZZ' } } },
        ),
      );
      expect(line(unknown, 'Price:')).toBe('Price: 2.50 ZZZ');
    } finally {
      vi.mocked(Intl.NumberFormat).mockRestore();
    }
  });

  it('lists only visible tickets, with a default name, a flexible price, and each sale window', async () => {
    const zone = 'Europe/Madrid';
    const content = await contentFor(
      'tickets1',
      eventDocument(
        { name: 'Tickets', timezone: zone },
        {
          ticket_types: [
            { name: 'Hidden', cents: 100, currency: 'usd', is_hidden: true },
            {
              name: 'Disabled',
              cents: 100,
              currency: 'usd',
              is_disabled: true,
            },
            { cents: 100, currency: 'usd' },
            { name: 'Freebie', type: 'free', cents: 500, currency: 'usd' },
            {
              name: 'Flex',
              cents: 1500,
              min_cents: 500,
              currency: 'usd',
              is_flexible: true,
            },
            {
              name: 'Fixed',
              cents: 1500,
              min_cents: 500,
              currency: 'usd',
              is_flexible: false,
            },
            {
              name: 'Soon',
              cents: 100,
              currency: 'usd',
              valid_start_at: '2026-11-02T00:01:00.000Z',
            },
            {
              name: 'Until',
              cents: 100,
              currency: 'usd',
              valid_end_at: '2026-11-04T17:59:00.000Z',
            },
            {
              name: 'Window',
              cents: 100,
              currency: 'usd',
              valid_start_at: '2026-11-02T00:01:00.000Z',
              valid_end_at: '2026-11-04T17:59:00.000Z',
            },
          ],
        },
      ),
    );

    expect(content).not.toContain('Hidden');
    expect(content).not.toContain('Disabled');
    expect(content).toContain('- Ticket — $1.00');
    expect(content).toContain('- Freebie — Free');
    expect(content).toContain('- Flex — from $5.00');
    expect(content).toContain('- Fixed — $15.00');
    expect(content).toContain('- Soon — $1.00, from 2026-11-02 01:01');
    expect(content).toContain('- Until — $1.00, until 2026-11-04 18:59');
    expect(content).toContain(
      '- Window — $1.00, 2026-11-02 01:01 UTC+01:00 (Europe/Madrid) – 2026-11-04 18:59 UTC+01:00 (Europe/Madrid)',
    );
    expect(content).not.toContain('undefined');
  });

  it('falls back to the absolute time when the zone or a local part is unusable', async () => {
    const invalid = await contentFor(
      'bad-zone',
      eventDocument({
        name: 'Bad zone',
        start_at: '2026-11-04T18:00:00.000Z',
        timezone: 'Not/AZone',
      }),
    );
    expect(line(invalid, 'Start:')).toBe(
      'Start: 2026-11-04T18:00:00.000Z (Not/AZone)',
    );

    for (const kind of TIME_PARTS) {
      mockTimeParts(undefined, [kind]);
      const content = await contentFor(
        'part1',
        eventDocument({
          name: 'Part',
          start_at: '2026-11-04T18:00:00.000Z',
          timezone: 'Europe/Madrid',
        }),
      );
      expect(`${kind} ${line(content, 'Start:') ?? ''}`).toBe(
        `${kind} Start: 2026-11-04T18:00:00.000Z (Europe/Madrid)`,
      );
      vi.mocked(Intl.DateTimeFormat).mockRestore();
    }
  });

  it('prints the offset for GMT, UTC, a numeric GMT offset, and an unknown name', async () => {
    const expected = new Map<string, string>([
      ['GMT', 'UTC+00:00'],
      ['UTC', 'UTC+00:00'],
      ['GMT+05:30', 'UTC+05:30'],
      ['EST', 'EST'],
    ]);
    for (const [name, offset] of expected) {
      mockTimeParts(name, []);
      const content = await contentFor(
        'offset1',
        eventDocument({
          name: 'Offset',
          start_at: '2026-11-04T18:00:00.000Z',
          timezone: 'Europe/Madrid',
        }),
      );
      expect(`${name} ${line(content, 'Start:') ?? ''}`).toContain(
        `${offset} (Europe/Madrid)`,
      );
      vi.mocked(Intl.DateTimeFormat).mockRestore();
    }
  });

  it('renders marks, empty blocks, and list structure in the description', async () => {
    const content = await contentFor(
      'marks1',
      eventDocument(
        { name: 'Marks', url: 'marks1' },
        { description_mirror: MARKS_MIRROR },
      ),
    );

    expect(content).toContain(String.raw`~~***a\*b***~~`);
    expect(content).toContain('`a\\`b`');
    expect(content).toContain('[**go**](https://example.com/real)');
    expect(content).not.toContain('example.com/bold');
    expect(content).toContain('- Line one  \n  line two  \n  line three');
    expect(content).toContain('- Keep');
    expect(content).toContain('> One\n\n> Two');
    expect(content).toContain('```\ncode\n```');
    expect(content).toContain('![](https://images.lumacdn.com/plain.png)');
    const rows = content.split('\n');
    expect(rows).toContain('# Fraction');
    expect(rows).toContain('# Zero');
    expect(rows).toContain('###### Deep');
    expect(rows).not.toContain('#');
    expect(rows.some((row) => row.includes('#######'))).toBe(false);
    expect(rows.filter((row) => row.startsWith('```'))).toHaveLength(2);
    expect(content).toContain('Ping');
    expect(content).not.toContain('Stray');
    expect(content).not.toContain('Stryker');
    expect(content).not.toContain('\n\n\n');
  });

  it('falls through for a calendar, a non-event kind, a bad body, or a response that left api.lu.ma', async () => {
    const notFound: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 404',
      httpStatus: 404,
    };
    await expect(
      read('https://luma.com/missing1', [[eventUrl('missing1'), notFound]]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });

    await expect(
      read('https://luma.com/it_business_madrid', [
        [
          eventUrl('it_business_madrid'),
          jsonBody(fixture('it_business_madrid.json')),
        ],
      ]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });

    await expect(
      read('https://luma.com/sf', [
        [eventUrl('sf'), jsonBody('{"kind":"discover-place","data":{}}')],
      ]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });

    await expect(
      read('https://luma.com/apawn7qt', [
        [eventUrl('apawn7qt'), jsonBody('{')],
      ]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });

    const offOrigin: WebResponse = {
      ...jsonBody(fixture('apawn7qt.json')),
      finalUrl: 'https://cdn.example/url',
    };
    await expect(
      read('https://luma.com/apawn7qt', [[eventUrl('apawn7qt'), offOrigin]]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
  });
});

function eventDocument(event: JsonObject, extra: JsonObject = {}): JsonObject {
  return { kind: 'event', data: { event, ...extra } };
}

async function contentFor(slug: string, document: JsonObject): Promise<string> {
  const { outcome } = await read(`https://luma.com/${slug}`, [
    [eventUrl(slug), response(document)],
  ]);
  return rendered(outcome);
}

function line(content: string, prefix: string): string | undefined {
  return content.split('\n').find((entry) => entry.startsWith(prefix));
}

const TIME_PARTS = [
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'timeZoneName',
] as const;

function mockTimeParts(
  zoneName: string | undefined,
  omit: ReadonlyArray<Intl.DateTimeFormatPartTypes>,
): void {
  const Original = Intl.DateTimeFormat;
  function zonedFormat(
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): Intl.DateTimeFormat {
    const real = new Original(locales, options);
    real.formatToParts = (date) =>
      new Original(locales, options)
        .formatToParts(date)
        .filter((part) => !omit.includes(part.type))
        .map((part) =>
          part.type === 'timeZoneName' && zoneName !== undefined
            ? { ...part, value: zoneName }
            : part,
        );
    return real;
  }
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(zonedFormat);
}

const ATTRS_MIRROR: JsonObject = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Section' }],
    },
    {
      type: 'image',
      attrs: { src: 'https://images.lumacdn.com/chart.png' },
    },
  ],
};

const MARKS_MIRROR: JsonObject = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'a*b',
          marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'a`b',
          marks: [{ type: 'code' }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'go',
          marks: [
            { type: 'bold', attrs: { href: 'https://example.com/bold' } },
            { type: 'link', attrs: { href: 'https://example.com/real' } },
          ],
        },
      ],
    },
    {
      type: 'bullet_list',
      content: [
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Stray' }],
                },
              ],
            },
          ],
        },
        {
          type: 'list_item',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Line one' },
                { type: 'hard_break' },
                { type: 'text', text: 'line two' },
                { type: 'hard_break' },
                { type: 'text', text: 'line three' },
              ],
            },
          ],
        },
        {
          type: 'list_item',
          content: [
            { type: 'paragraph', content: [] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Keep' }] },
          ],
        },
        { type: 'list_item', content: [] },
      ],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
      ],
    },
    { type: 'blockquote', content: [] },
    {
      type: 'code_block',
      content: [{ type: 'text', text: 'code' }],
    },
    { type: 'code_block', content: [] },
    { type: 'heading', content: [] },
    {
      type: 'heading',
      attrs: { level: 2.5 },
      content: [{ type: 'text', text: 'Fraction' }],
    },
    {
      type: 'heading',
      attrs: { level: 0 },
      content: [{ type: 'text', text: 'Zero' }],
    },
    {
      type: 'heading',
      attrs: { level: 8 },
      content: [{ type: 'text', text: 'Deep' }],
    },
    {
      type: 'image',
      attrs: { src: 'https://images.lumacdn.com/plain.png' },
    },
    { type: 'mystery', content: [] },
    { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    { type: 'paragraph', content: [{ type: 'text' }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'mention',
          content: [{ type: 'text', text: 'Ping' }],
        },
      ],
    },
  ],
};

const RICH_MIRROR: JsonObject = {
  type: 'doc',
  content: [
    {
      type: 'bullet_list',
      content: [
        {
          type: 'list_item',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Parent' }],
            },
            {
              type: 'bullet_list',
              content: [
                {
                  type: 'list_item',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Child' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'ordered_list',
      content: [
        {
          type: 'list_item',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
          ],
        },
        {
          type: 'list_item',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Second' }],
            },
          ],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Line one' },
        { type: 'hard_break' },
        { type: 'text', text: 'line two' },
      ],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A quote' }] },
      ],
    },
    {
      type: 'code_block',
      content: [{ type: 'text', text: 'code' }],
    },
    {
      type: 'image',
      attrs: {
        src: 'https://images.lumacdn.com/chart.png',
        alt: 'Chart',
      },
    },
    {
      type: 'image',
      attrs: { src: 'blob:https://luma.com/local', alt: 'skip' },
    },
  ],
};

const APAWN7QT = [
  '# Decision Intelligence - How AI Changed the Way We Make Decisions',
  '',
  'Visibility: private',
  'Start: 2026-11-04 18:00 UTC+01:00 (Europe/Madrid)',
  'End: 2026-11-04 22:00 UTC+01:00 (Europe/Madrid)',
  'Location: Mad Tech Campus, P.º de la Chopera, 14, Arganzuela, 28045 Madrid, Spain',
  'Hosts: Mikhail Gutnikov, Diana Agliamutdinova (https://luma.com/diapant), Ana',
  'Organizer: IT & Business Community in Madrid (https://luma.com/it_business_madrid)',
  'Registration: open',
  'Price: €30.00–€60.00',
  'Tickets:',
  '- Early Bird — €30.00, until 2026-10-25 23:59 UTC+01:00 (Europe/Madrid)',
  '- Late Bird — €45.00, 2026-10-26 00:01 UTC+01:00 (Europe/Madrid) – 2026-11-01 23:59 UTC+01:00 (Europe/Madrid)',
  '- Extremely Late Bird — €60.00, 2026-11-02 00:01 UTC+01:00 (Europe/Madrid) – 2026-11-04 17:59 UTC+01:00 (Europe/Madrid)',
  'Spots remaining: 96',
  'Guests: 4',
  'Cover: https://images.lumacdn.com/uploads/lp/9e2de26d-beac-4e3d-850c-28044b3c5d42.png',
  'URL: https://luma.com/apawn7qt',
  '',
  '# Decision Intelligence: How AI Is Changing the Way We Make Decisions',
  '',
  'Join us for an evening of talks and networking with people building and applying AI in the real world!',
  '',
  "We'll explore how AI helps us make better decisions - from business strategy and applied ML to deepfake detection, biometric security, and AI safety.",
  '',
  '🎤 Our Speakers',
  '',
  '[**Arkady Sandler**](https://www.linkedin.com/in/asandler/) — AI/ML veteran, 5x founder and entrepreneur. Working on AI-powered decision-making and innovation.',
  '',
  '[**Efim Boieru**](https://www.linkedin.com/in/efimboieru/) — Senior ML Engineering Manager at Incode, leading the development of deepfake detection, face liveness, and biometric security systems.',
  '',
  '[**Alena Air**](https://www.linkedin.com/in/alena-air/) — AI Safety Research Scientist & Engineer, researching autonomous AI systems and their risks.',
  '',
  '[**Daria Nikanorova**](https://www.linkedin.com/in/daria-nikanorova/) — Machine Learning Team Lead, building ML models that deliver real business results.',
  '',
  "Who's it for?",
  '',
  'AI/ML engineers, founders, product managers, entrepreneurs, and anyone interested in practical AI.',
  '',
  '**The meetup and all talks will be held in English.**',
  '',
  'Come to learn something new, meet interesting people, and have some good conversations about AI.',
  '',
  '**See you there! 🚀**',
].join('\n');
