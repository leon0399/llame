import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { type EngineRequest } from './chain';
import { YANDEX_SEARCH_URL, createYandexEngine } from './yandex';
import { removalFor } from '../../testing/web-search-removal';
import { captureFetch } from '../../testing/web-search-fetch';

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'pgvector release',
  objective: undefined,
  recency: 'week',
  limit: 5,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  chatId: 'chat',
  removal: removalFor(undefined),
  ...overrides,
});
const config = {
  key: 'secret',
  searchType: 'com',
  folderId: undefined,
} as const satisfies Parameters<typeof createYandexEngine>[0];
const YandexRequestSchema = z
  .object({
    query: z
      .object({
        searchType: z.string(),
        queryText: z.string(),
        familyMode: z.string(),
      })
      .strict(),
    groupSpec: z
      .object({
        groupMode: z.string(),
        groupsOnPage: z.number(),
        docsInGroup: z.number(),
      })
      .strict(),
    maxPassages: z.number(),
    responseFormat: z.string(),
    period: z.string().optional(),
    folderId: z.string().optional(),
  })
  .strict();
type YandexRequest = z.infer<typeof YandexRequestSchema>;
async function parseBody(
  init: RequestInit | undefined,
): Promise<YandexRequest> {
  const text = await new Response(init?.body ?? null).text();
  // SAFETY: The schema validates JSON parsed from the captured vendor request.
  return YandexRequestSchema.parse(JSON.parse(text) as unknown);
}

/** One response body as the vendor wraps it: Base64 XML in a JSON field. */
function envelope(xml: string): string {
  return JSON.stringify({
    rawData: Buffer.from(xml, 'utf8').toString('base64'),
  });
}
const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');
/**
 * A response envelope around the fixture, which is hand-built from the
 * documented response format: the vendor's shape, not a captured payload.
 */
const fixtureEnvelope = (): string =>
  envelope(fixture('yandex-web-search.xml'));
const errorXml = (code: string, text: string): string =>
  envelope(
    `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0"><response date="20261027T120000"><error code="${code}">${text}</error></response></yandexsearch>`,
  );
const noResultsXml = (): string =>
  envelope(
    `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0"><response date="20261027T120000"><reqid>r</reqid><results><grouping mode="flat" groups-on-page="5" docs-in-group="1" /></results></response></yandexsearch>`,
  );

/** The results the fixture maps to, as the output normalizes them. */
const fixtureMapped = [
  {
    title: 'pgvector "0.8.7" Released & notes',
    url: 'https://www.postgresql.org/about/news/pgvector-087-released-3392/',
    snippet: 'pgvector 0.8.7 adds HNSW index build parallelism and iterators.',
    published: '2026-10-05',
  },
  {
    title: 'pgvector — PostgreSQL documentation',
    url: 'https://www.postgresql.org/docs/current/pgvector.html',
    snippet: 'pgvector is an open-source vector similarity search extension.',
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('Yandex adapter', () => {
  it("sends the request and maps the fixture's flat-group results", async () => {
    const recorded = captureFetch(fixtureEnvelope());
    const engine = createYandexEngine(config, { fetch: recorded.fetch });

    const result = await engine(request());

    expect(recorded.seen().url).toBe(YANDEX_SEARCH_URL);
    expect(recorded.seen().init?.method).toBe('POST');
    const headers = new Headers(recorded.seen().init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('llame/test');
    expect(headers.get('authorization')).toBe('Api-Key secret');
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: {
        searchType: 'SEARCH_TYPE_COM',
        queryText: 'pgvector release',
        familyMode: 'FAMILY_MODE_MODERATE',
      },
      groupSpec: {
        groupMode: 'GROUP_MODE_FLAT',
        groupsOnPage: 5,
        docsInGroup: 1,
      },
      maxPassages: 3,
      responseFormat: 'FORMAT_XML',
      period: 'PERIOD_2_WEEKS',
    });
    expect(result).toStrictEqual({
      kind: 'results',
      results: fixtureMapped,
      notes: ['yandex mapped week to two weeks'],
    });
  });

  it('keeps both results of one host and drops a document without a URL', async () => {
    const recorded = captureFetch(
      envelope(
        `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0"><response date="20261027T120000"><results><grouping mode="flat" groups-on-page="2" docs-in-group="1">
<group><doc id="1"><url>https://a.test/x</url><title>A</title></doc></group>
<group><doc id="2"><title>No URL</title></doc></group>
<group><doc id="3"><url>https://a.test/y</url><title>B</title></doc></group>
</grouping></results></response></yandexsearch>`,
      ),
    );

    await expect(
      createYandexEngine(config, { fetch: recorded.fetch })(
        request({ recency: undefined }),
      ),
    ).resolves.toStrictEqual({
      kind: 'results',
      results: [
        { title: 'A', url: 'https://a.test/x' },
        { title: 'B', url: 'https://a.test/y' },
      ],
    });
    expect((await parseBody(recorded.seen().init)).groupSpec).toStrictEqual({
      groupMode: 'GROUP_MODE_FLAT',
      groupsOnPage: 5,
      docsInGroup: 1,
    });
  });

  it('sends the folder id the entry sets and omits it otherwise', async () => {
    const withFolder = captureFetch(fixtureEnvelope());
    await createYandexEngine(
      { ...config, folderId: 'folder-id' },
      { fetch: withFolder.fetch },
    )(request());
    expect((await parseBody(withFolder.seen().init)).folderId).toBe(
      'folder-id',
    );

    const withoutFolder = captureFetch(fixtureEnvelope());
    await createYandexEngine(config, { fetch: withoutFolder.fetch })(request());
    expect(await parseBody(withoutFolder.seen().init)).not.toHaveProperty(
      'folderId',
    );
  });

  it('sends no objective, which the vendor has no field for', async () => {
    const recorded = captureFetch(fixtureEnvelope());
    const result = await createYandexEngine(config, {
      fetch: recorded.fetch,
    })(request({ objective: 'compare pgvector benchmarks' }));

    // The strict request schema refuses any field the vendor does not take.
    const body = await parseBody(recorded.seen().init);
    expect(body.query.queryText).toBe('pgvector release');
    expect(result).toHaveProperty('results');
  });

  it.each([
    ['day', 'PERIOD_DAY', undefined],
    ['week', 'PERIOD_2_WEEKS', 'yandex mapped week to two weeks'],
    ['month', 'PERIOD_MONTH', undefined],
    ['year', undefined, 'recency not applied by yandex'],
    [undefined, undefined, undefined],
  ] as const)(
    'maps recency %s to the period %s',
    async (recency, period, note) => {
      const recorded = captureFetch(fixtureEnvelope());
      const result = await createYandexEngine(config, {
        fetch: recorded.fetch,
      })(request({ recency }));

      const body = await parseBody(recorded.seen().init);
      expect(body.period).toBe(period);
      expect(result).toStrictEqual({
        kind: 'results',
        results: fixtureMapped,
        ...(note !== undefined && { notes: [note] }),
      });
    },
  );

  it('clamps the group count to the vendor maximum', async () => {
    const recorded = captureFetch(fixtureEnvelope());
    await createYandexEngine(config, { fetch: recorded.fetch })(
      request({ limit: 200 }),
    );
    expect((await parseBody(recorded.seen().init)).groupSpec.groupsOnPage).toBe(
      100,
    );
  });

  it('is empty when the vendor finds nothing', async () => {
    const recorded = captureFetch(noResultsXml());
    await expect(
      createYandexEngine(config, { fetch: recorded.fetch })(request()),
    ).resolves.toStrictEqual({
      kind: 'empty',
      notes: ['yandex mapped week to two weeks'],
    });
  });

  it.each([
    ['42', 'auth', 'The web search engine rejected authentication.'],
    ['32', 'rate_limited', 'The web search engine rate limited the request.'],
    ['55', 'rate_limited', 'The web search engine rate limited the request.'],
    ['100', 'challenge', 'The web search engine presented a challenge.'],
    ['19', 'upstream_error', 'The web search engine failed upstream.'],
  ] as const)(
    'reads in-body error code %s as %s after HTTP 200',
    async (code, failureClass, message) => {
      const engine = createYandexEngine(
        { ...config, folderId: 'b1g-folder-id' },
        {
          fetch: captureFetch(
            errorXml(
              code,
              'request b1g-folder-id refused by the search backend',
            ),
          ).fetch,
        },
      );

      // The fixed message is the whole text: the XML error text never reaches it.
      await expect(engine(request())).rejects.toMatchObject({
        failureClass,
        message,
      });
    },
  );

  it.each(['2', '15'] as const)(
    'reads in-body error code %s as an empty outcome with the recency note',
    async (code) => {
      const engine = createYandexEngine(config, {
        fetch: captureFetch(errorXml(code, 'No results found')).fetch,
      });

      await expect(engine(request())).resolves.toStrictEqual({
        kind: 'empty',
        notes: ['yandex mapped week to two weeks'],
      });
    },
  );

  it('reads the in-body error before the results of the same response', async () => {
    const engine = createYandexEngine(config, {
      fetch: captureFetch(
        envelope(
          `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0"><response date="20261027T120000"><error code="55">rate limit exceeded</error><results><grouping mode="flat" groups-on-page="5" docs-in-group="1"><group><doc id="1"><url>https://a.test/x</url><title>A</title></doc></group></grouping></results></response></yandexsearch>`,
        ),
      ).fetch,
    });

    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'rate_limited',
      message: 'The web search engine rate limited the request.',
    });
  });

  it('classifies statuses without exposing an echoed folder id', async () => {
    const cases = [
      [401, 'auth', 'The web search engine rejected authentication.'],
      [403, 'auth', 'The web search engine rejected authentication.'],
      [429, 'rate_limited', 'The web search engine rate limited the request.'],
      [408, 'timeout', 'The web search engine timed out.'],
      [504, 'timeout', 'The web search engine timed out.'],
      [400, 'upstream_error', 'The web search engine failed upstream.'],
      [500, 'upstream_error', 'The web search engine failed upstream.'],
    ] as const;

    for (const [status, failureClass, message] of cases) {
      // A 403 body names the folder, the cloud, and the organization, as the
      // vendor's own response does.
      const engine = createYandexEngine(
        { ...config, folderId: 'b1g-folder-id' },
        {
          fetch: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  code: 7,
                  message:
                    'Permission to [resource-manager.folder b1g-folder-id] denied',
                }),
                { status },
              ),
            ),
        },
      );

      await expect(engine(request())).rejects.toMatchObject({
        failureClass,
        message,
      });
    }
  });

  it.each([
    ['a body outside the Base64 alphabet', '{"rawData":"%%%"}'],
    ['a body without the raw data field', '{"unexpected":true}'],
    ['a body whose raw data is not a response', envelope('page not found')],
    ['raw data that decodes to an empty document', envelope('')],
  ])('fails upstream for %s', async (_description, body) => {
    await expect(
      createYandexEngine(config, { fetch: captureFetch(body).fetch })(
        request(),
      ),
    ).rejects.toMatchObject({
      failureClass: 'upstream_error',
      message: 'The web search engine failed upstream.',
    });
  });
});
