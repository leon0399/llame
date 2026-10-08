import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type Reply,
} from '../../../../testing/github-test-io';
import { createDoiAdapter } from './adapter';

const adapter = createDoiAdapter(
  { id: 'doi', use: 'doi' },
  { apiOrigin: API_ORIGIN },
);
const SELECT =
  'select=display_name,type,publication_date,authorships,primary_location,cited_by_count,open_access,abstract_inverted_index,is_retracted';

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, urls: run.requests.map(({ url }) => url) };
}

describe('DOI adapter claim', () => {
  it.each([
    'https://doi.org/10.1145/3442188.3445922',
    'https://dx.doi.org/10.1038/nature14539',
    'https://doi.org/10.1145%2F3442188.3445922',
    'https://doi.org/10.1002/(SICI)1097-0258(19980815/30)17:15/16%3C1661::AID-SIM968%3E3.0.CO;2-2',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://doi.org/10.1038/nature14539',
    'https://doi.org/',
    'https://doi.org/11.1038/nature14539',
    'https://doi.org/10.1038',
    'https://www.doi.org/10.1038/nature14539',
    'https://doi.org/10.1038/%E0%A4%A',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('DOI adapter read', () => {
  it('renders the work metadata and rebuilds the abstract', async () => {
    const url = `${API_ORIGIN}/works/doi:10.1145/3442188.3445922?${SELECT}`;

    const { outcome, urls } = await read(
      'https://doi.org/10.1145/3442188.3445922',
      [
        [
          url,
          response({
            display_name: 'On the Dangers of Stochastic Parrots',
            type: 'conference-paper',
            publication_date: '2021-03-01',
            authorships: [
              { author: { display_name: 'Emily M. Bender' } },
              { author: { display_name: 'Timnit Gebru' } },
            ],
            primary_location: { source: { display_name: 'FAccT' } },
            cited_by_count: 6776,
            open_access: { oa_url: 'https://example.org/paper.pdf' },
            abstract_inverted_index: {
              large: [2],
              models: [3],
              Ever: [0],
              'ever-': [1],
            },
            is_retracted: true,
          }),
        ],
      ],
    );

    expect(urls).toStrictEqual([url]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# On the Dangers of Stochastic Parrots',
        '',
        'Retracted: yes',
        'Authors: Emily M. Bender, Timnit Gebru',
        'Published: 2021-03-01 in FAccT (conference-paper)',
        'Cited by: 6,776',
        'Open access: https://example.org/paper.pdf',
        'DOI: https://doi.org/10.1145/3442188.3445922',
        '',
        '## Abstract',
        '',
        'Ever ever- large models',
      ].join('\n'),
    });
  });

  it('encodes a decoded DOI for the API and keeps sparse metadata', async () => {
    const url = `${API_ORIGIN}/works/doi:10.1000/a%3Cb%3E?${SELECT}`;

    const { outcome, urls } = await read('https://doi.org/10.1000/a%3Cb%3E', [
      [url, response({ display_name: null })],
    ]);

    expect(urls).toStrictEqual([url]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      content: '# 10.1000/a<b>\n\nDOI: https://doi.org/10.1000/a<b>',
    });
  });

  it('renders a work with null retraction state and sparse abstract positions', async () => {
    const url = `${API_ORIGIN}/works/doi:10.1097/x?${SELECT}`;

    const { outcome } = await read('https://doi.org/10.1097/x', [
      [
        url,
        response({
          display_name: null,
          is_retracted: null,
          abstract_inverted_index: { far: [4_294_967_294], near: [0] },
        }),
      ],
    ]);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      content:
        '# 10.1097/x\n\nDOI: https://doi.org/10.1097/x\n\n## Abstract\n\nnear far',
    });
  });

  it.each([
    [99, ''],
    [100, ' (first 100 listed; there may be more)'],
    [101, ''],
  ])('lists %i authors with the note %j', async (count, note) => {
    const names = Array.from({ length: count }, (_, i) => `Author ${i + 1}`);
    const url = `${API_ORIGIN}/works/doi:10.1103/many?${SELECT}`;

    const { outcome } = await read('https://doi.org/10.1103/many', [
      [
        url,
        response({
          display_name: 'A collaboration paper',
          authorships: names.map((display_name) => ({
            author: { display_name },
          })),
        }),
      ],
    ]);

    const content = outcome.kind === 'rendered' ? outcome.content : '';
    expect(
      content.split('\n').find((line) => line.startsWith('Authors: ')),
    ).toBe(`Authors: ${names.join(', ')}${note}`);
  });

  it('falls through for a DOI OpenAlex does not know', async () => {
    const notFound: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 404',
      httpStatus: 404,
    };

    const { outcome } = await read('https://doi.org/10.1002/x', [
      [`${API_ORIGIN}/works/doi:10.1002/x?${SELECT}`, notFound],
    ]);

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'status' });
  });
});
