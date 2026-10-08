import { z } from 'zod';

import type { OsvWebAdapterConfig } from '../../../../instance-config/llame-config';
import { parseJsonBody, primaryFailure, type WebAdapter } from '../contract';

/** OSV.dev: keyless advisories aggregated from GitHub, NVD, PyPA, RustSec,
 *  Go, distributions, and others, each by its own id or a CVE alias. */
export const OSV_API_ORIGIN = 'https://api.osv.dev';
/** Lists GitHub and distributions can run to hundreds of rows. */
const MAX_AFFECTED = 50;
const MAX_REFERENCES = 30;
const MAX_RELATED = 20;

const OSV_ID = /^[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9._:-]{1,100}$/u;
const CVE_ID = /^CVE-\d{4}-\d{4,}$/u;
const GHSA_ID = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/u;
/** A page path that names an advisory, with the id pattern it takes. */
const SITES = {
  'osv.dev': { prefix: '/vulnerability/', id: OSV_ID },
  'nvd.nist.gov': { prefix: '/vuln/detail/', id: CVE_ID },
  'github.com': { prefix: '/advisories/', id: GHSA_ID },
} as const satisfies Readonly<
  Record<string, { readonly prefix: string; readonly id: RegExp }>
>;

const RANGE = z.object({
  type: z.string(),
  repo: z.string().optional(),
  events: z.array(z.record(z.string(), z.string())).default([]),
});

const VULN = z.object({
  id: z.string(),
  summary: z.string().optional(),
  details: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  published: z.string().optional(),
  modified: z.string().optional(),
  withdrawn: z.string().optional(),
  severity: z
    .array(z.object({ type: z.string(), score: z.string() }))
    .default([]),
  affected: z
    .array(
      z.object({
        package: z
          .object({ ecosystem: z.string(), name: z.string() })
          .nullable()
          .optional(),
        ranges: z.array(RANGE).default([]),
      }),
    )
    .default([]),
  references: z
    .array(z.object({ type: z.string(), url: z.string() }))
    .default([]),
  database_specific: z
    .object({
      severity: z.string().optional(),
      cwe_ids: z.array(z.string()).optional(),
    })
    .optional(),
});
type Vuln = z.infer<typeof VULN>;

/** Matches an advisory page on OSV.dev, an NVD CVE page, a GitHub advisory,
 *  or a cve.org record; the id is what OSV.dev indexes it by. */
export function parseOsvUrl(source: URL): string | undefined {
  if (source.protocol !== 'https:') return undefined;
  const host = source.host.replace(/^www\./u, '');
  if (host === 'cve.org' && source.pathname === '/CVERecord') {
    const id = source.searchParams.get('id') ?? '';
    return CVE_ID.test(id) ? id : undefined;
  }
  const site = Object.entries(SITES).find(([name]) => name === host)?.[1];
  if (site === undefined) return undefined;
  if (!source.pathname.startsWith(site.prefix)) return undefined;
  const id = source.pathname.slice(site.prefix.length).replace(/\/$/u, '');
  return site.id.test(id) ? id : undefined;
}

/** Creates the native OSV adapter. */
export function createOsvAdapter(
  config: OsvWebAdapterConfig,
  options: { readonly apiOrigin?: string } = {},
): WebAdapter {
  const api = options.apiOrigin ?? OSV_API_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseOsvUrl(source) !== undefined,
    read: async (source, io) => {
      const id = parseOsvUrl(source)!;
      const fetched = await io.fetch(
        `${api}/v1/vulns/${encodeURIComponent(id)}`,
        { accept: 'application/json' },
      );
      if ('type' in fetched) return primaryFailure(fetched);
      const vuln = parseJsonBody(fetched.body, VULN);
      if (vuln === undefined) return { kind: 'failed', failure: 'parse' };
      const notes: Array<string> = [];
      return {
        kind: 'rendered',
        content: renderVuln(vuln, notes),
        mediaType: 'text/markdown',
        notes,
      };
    },
  };
}

function renderVuln(vuln: Vuln, notes: Array<string>): string {
  const fields: Array<[string, string | undefined]> = [
    ['Withdrawn', vuln.withdrawn],
    ['Aliases', vuln.aliases.join(', ')],
    ['Severity', severityOf(vuln)],
    ['CWE', vuln.database_specific?.cwe_ids?.join(', ')],
    ['Published', vuln.published],
    ['Modified', vuln.modified],
    ['Related', capped(vuln.related, MAX_RELATED, 'related', notes).join(', ')],
    ['URL', `https://osv.dev/vulnerability/${vuln.id}`],
  ];
  const title = vuln.summary ? `${vuln.id}: ${vuln.summary}` : vuln.id;
  const lines = [`# ${title}`, ''];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  const affected = capped(vuln.affected, MAX_AFFECTED, 'affected', notes);
  const references = capped(
    vuln.references,
    MAX_REFERENCES,
    'references',
    notes,
  );
  const details = vuln.details?.trim();
  return [
    ...lines,
    ...section(
      `Affected (${vuln.affected.length})`,
      affected.flatMap(affectedLines),
    ),
    ...section('Details', details ? [details] : []),
    ...section(
      'References',
      references.map(({ type, url }) => `- ${type}: ${url}`),
    ),
  ].join('\n');
}

function section(
  heading: string,
  rows: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return rows.length === 0 ? [] : ['', `## ${heading}`, '', ...rows];
}

/** The scores OSV carries, then the source database's own rating. */
function severityOf(vuln: Vuln): string {
  return [
    vuln.database_specific?.severity,
    ...vuln.severity.map(({ score }) => score),
  ]
    .filter(Boolean)
    .join('; ');
}

function affectedLines(entry: Vuln['affected'][number]): Array<string> {
  const name = entry.package
    ? `${entry.package.ecosystem} ${entry.package.name}`
    : undefined;
  if (entry.ranges.length === 0) return name ? [`- ${name}`] : [];
  return entry.ranges.map((range) => {
    const subject = name ?? `${range.type} ${range.repo ?? ''}`.trim();
    const events = range.events
      .flatMap((event) => Object.entries(event))
      .map(([kind, version]) => `${kind} ${version}`)
      .join(', ');
    return `- ${subject}: ${events || 'all versions'}`;
  });
}

function capped<T>(
  items: ReadonlyArray<T>,
  max: number,
  label: string,
  notes: Array<string>,
): ReadonlyArray<T> {
  if (items.length > max) {
    notes.push(`${label} truncated: the first ${max} of ${items.length}`);
  }
  return items.slice(0, max);
}
