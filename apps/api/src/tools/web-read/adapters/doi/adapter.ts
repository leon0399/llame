import { z } from 'zod';

import type { DoiWebAdapterConfig } from '../../../../instance-config/llame-config';
import { parseJsonBody, primaryFailure, type WebAdapter } from '../contract';

/** OpenAlex: keyless scholarly metadata, abstracts included, for Crossref
 *  and other registrars' DOIs. */
export const OPENALEX_API_ORIGIN = 'https://api.openalex.org';
const SELECT = [
  'display_name',
  'type',
  'publication_date',
  'authorships',
  'primary_location',
  'cited_by_count',
  'open_access',
  'abstract_inverted_index',
  'is_retracted',
].join(',');
const DOI_PATH = /^\/(10\.\d{4,9}\/.+)$/u;

const WORK = z.object({
  display_name: z.string().nullable(),
  type: z.string().nullable().default(null),
  publication_date: z.string().nullable().default(null),
  authorships: z
    .array(z.object({ author: z.object({ display_name: z.string() }) }))
    .default([]),
  primary_location: z
    .object({
      source: z.object({ display_name: z.string() }).nullable().default(null),
    })
    .nullable()
    .default(null),
  cited_by_count: z.number().int().nullable().default(null),
  open_access: z
    .object({ oa_url: z.string().nullable().default(null) })
    .nullable()
    .default(null),
  abstract_inverted_index: z
    .record(z.string(), z.array(z.number().int()))
    .nullable()
    .default(null),
  is_retracted: z.boolean().default(false),
});
type Work = z.infer<typeof WORK>;

/** Matches `doi.org/{doi}` and `dx.doi.org/{doi}`, the DOI percent-decoded. */
export function parseDoiUrl(source: URL): string | undefined {
  if (
    source.protocol !== 'https:' ||
    (source.host !== 'doi.org' && source.host !== 'dx.doi.org')
  ) {
    return undefined;
  }
  const encoded = DOI_PATH.exec(source.pathname)?.[1];
  if (encoded === undefined) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/** Creates the native DOI adapter. */
export function createDoiAdapter(
  config: DoiWebAdapterConfig,
  options: { readonly apiOrigin?: string } = {},
): WebAdapter {
  const api = options.apiOrigin ?? OPENALEX_API_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseDoiUrl(source) !== undefined,
    read: async (source, io) => {
      const doi = parseDoiUrl(source)!;
      const path = doi.split('/').map(encodeURIComponent).join('/');
      const fetched = await io.fetch(
        `${api}/works/doi:${path}?select=${SELECT}`,
        { accept: 'application/json' },
      );
      if ('type' in fetched) return primaryFailure(fetched);
      const work = parseJsonBody(fetched.body, WORK);
      if (work === undefined) return { kind: 'failed', failure: 'parse' };
      return {
        kind: 'rendered',
        content: renderWork(doi, work),
        mediaType: 'text/markdown',
        notes: [],
      };
    },
  };
}

function renderWork(doi: string, work: Work): string {
  const venue = work.primary_location?.source?.display_name;
  const published = [
    work.publication_date,
    venue && `in ${venue}`,
    work.type && `(${work.type})`,
  ]
    .filter(Boolean)
    .join(' ');
  const fields: Array<[string, string | null | undefined]> = [
    ['Retracted', work.is_retracted ? 'yes' : undefined],
    [
      'Authors',
      work.authorships.map(({ author }) => author.display_name).join(', '),
    ],
    ['Published', published],
    ['Cited by', work.cited_by_count?.toLocaleString('en-US')],
    ['Open access', work.open_access?.oa_url],
    ['DOI', `https://doi.org/${doi}`],
  ];
  const lines = [`# ${work.display_name ?? doi}`, ''];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  const abstract = abstractText(work.abstract_inverted_index);
  if (abstract) lines.push('', '## Abstract', '', abstract);
  return lines.join('\n');
}

/** OpenAlex ships an abstract as an inverted index: each word with the
 *  positions it occupies. */
function abstractText(
  index: Readonly<Record<string, ReadonlyArray<number>>> | null,
): string {
  const words: Array<string> = [];
  for (const [word, positions] of Object.entries(index ?? {})) {
    for (const position of positions) words[position] = word;
  }
  return words.filter((word) => word !== undefined).join(' ');
}
