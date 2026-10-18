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
