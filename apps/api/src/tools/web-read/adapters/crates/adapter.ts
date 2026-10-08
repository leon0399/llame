import { z } from 'zod';

import type { CratesWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebFetchFailure, WebRequestInit } from '../../http-client';
import { convertToMarkdown } from '../../pipeline';
import {
  loadSection,
  omissionNote,
  parseJsonBody,
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';

/** crates.io; its API needs no key, only the `User-Agent` every request
 *  already carries. */
export const CRATES_ORIGIN = 'https://crates.io';

const JSON_INIT: WebRequestInit = { accept: 'application/json' };
/** With any `include`, crates.io returns only the listed crate fields. */
const INCLUDE = 'default_version,keywords,categories,downloads';

type CratesTarget = { readonly name: string; readonly version?: string };

const CRATE_PATH =
  /^\/crates\/([A-Za-z][A-Za-z0-9_-]{0,63})(?:\/([0-9][0-9A-Za-z.+-]{0,63}))?$/u;

const SKIPPED = z.unknown().transform(() => undefined);
const TEXT = z.string().or(SKIPPED).optional();
const VERSION = z.object({
  num: z.string(),
  license: TEXT,
  rust_version: TEXT,
  edition: TEXT,
  yanked: z.boolean().optional(),
  created_at: TEXT,
  features: z.record(z.string(), z.unknown()).or(SKIPPED).optional(),
  published_by: z.object({ login: z.string() }).or(SKIPPED).optional(),
});
type Version = z.infer<typeof VERSION>;
const CRATE_PAGE = z.object({
  crate: z.object({
    name: z.string(),
    description: TEXT,
    default_version: z
      .string()
      .nullable()
      .transform((version) => version ?? undefined),
    downloads: z.number().optional(),
    recent_downloads: z.number().or(SKIPPED).optional(),
    repository: TEXT,
    homepage: TEXT,
    documentation: TEXT,
    keywords: z.array(z.string()).or(SKIPPED).optional(),
    categories: z.array(z.string()).or(SKIPPED).optional(),
  }),
  versions: z.array(VERSION),
});
type Crate = z.infer<typeof CRATE_PAGE>['crate'];
const VERSION_PAGE = z.object({ version: VERSION });
const DEPENDENCY_PAGE = z.object({
  dependencies: z.array(
    z.object({
      crate_id: z.string(),
      req: z.string(),
      kind: z.string(),
      optional: z.boolean(),
    }),
  ),
});
type Dependency = z.infer<typeof DEPENDENCY_PAGE>['dependencies'][number];

/** Matches `crates.io/crates/{name}` and `/crates/{name}/{version}`. */
export function parseCratesUrl(source: URL): CratesTarget | undefined {
  if (source.protocol !== 'https:' || source.host !== 'crates.io') {
    return undefined;
  }
  const match = CRATE_PATH.exec(source.pathname);
  if (match === null) return undefined;
  const [, name = '', version] = match;
  return version === undefined ? { name } : { name, version };
}

/** Creates the native crates.io adapter. */
export function createCratesAdapter(
  config: CratesWebAdapterConfig,
  options: { readonly origin?: string } = {},
): WebAdapter {
  const origin = options.origin ?? CRATES_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseCratesUrl(source) !== undefined,
    read: (source, io) => readCrate(parseCratesUrl(source)!, io, origin),
  };
}

/** The crate and its version are primary; the dependency list and README
 *  are secondary sections. */
async function readCrate(
  target: CratesTarget,
  io: WebAdapterIo,
  origin: string,
): Promise<WebAdapterOutcome> {
  const fetched = await io.fetch(
    `${origin}/api/v1/crates/${target.name}?include=${INCLUDE}`,
    JSON_INIT,
  );
  if ('type' in fetched) return primaryFailure(fetched);
  const page = parseJsonBody(fetched.body, CRATE_PAGE);
  if (page === undefined) return { kind: 'failed', failure: 'parse' };
  // Later requests use the canonical name: crates.io accepts `-` for `_` and
  // any case, but its README redirect answers 403 for another spelling.
  const api = `${origin}/api/v1/crates/${page.crate.name}`;
  const version = await resolveVersion(target, page, api, io);
  if ('outcome' in version) return version.outcome;

  const notes: Array<string> = [];
  const versionApi = `${api}/${version.num}`;
  const dependencies = await loadSection(
    'dependencies',
    io.fetch(`${versionApi}/dependencies`, JSON_INIT),
    notes,
  );
  if ('fatal' in dependencies) return primaryFailure(dependencies.fatal);
  const readme =
    dependencies.spent === undefined
      ? await loadSection('readme', io.fetch(`${versionApi}/readme`), notes)
      : skipSection('readme', dependencies.spent, notes);
  if ('fatal' in readme) return primaryFailure(readme.fatal);
  return {
    kind: 'rendered',
    content: renderCrate(
      page.crate,
      version,
      parseDependencies(dependencies.body, notes),
      readme.body,
    ),
    mediaType: 'text/markdown',
    notes,
  };
}

function parseDependencies(
  body: string | undefined,
  notes: Array<string>,
): ReadonlyArray<Dependency> | undefined {
  if (body === undefined) return undefined;
  const page = parseJsonBody(body, DEPENDENCY_PAGE);
  if (page === undefined) notes.push('dependencies omitted: parse');
  return page?.dependencies;
}

/** A section a spent call deadline skips gets the note its own request would. */
function skipSection(
  section: string,
  spent: WebFetchFailure,
  notes: Array<string>,
) {
  notes.push(omissionNote(section, spent));
  return { body: undefined };
}

/** The default version arrives with the crate; another one costs a request. */
async function resolveVersion(
  target: CratesTarget,
  page: z.infer<typeof CRATE_PAGE>,
  api: string,
  io: WebAdapterIo,
): Promise<Version | { readonly outcome: WebAdapterOutcome }> {
  // crates.io may report no default version; only a pinned URL reads then.
  const wanted = target.version ?? page.crate.default_version;
  if (wanted === undefined) {
    return { outcome: { kind: 'failed', failure: 'empty' } };
  }
  const included = page.versions.find(({ num }) => num === wanted);
  if (included !== undefined) return included;
  const fetched = await io.fetch(`${api}/${wanted}`, JSON_INIT);
  if ('type' in fetched) return { outcome: primaryFailure(fetched) };
  const parsed = parseJsonBody(fetched.body, VERSION_PAGE);
  return parsed === undefined
    ? { outcome: { kind: 'failed', failure: 'parse' } }
    : parsed.version;
}

function renderCrate(
  crate: Crate,
  version: Version,
  dependencies: ReadonlyArray<Dependency> | undefined,
  readme: string | undefined,
): string {
  const lines = [`# ${crate.name} ${version.num}`, ''];
  const description = crate.description?.trim();
  if (description) lines.push(description, '');
  const fields: Array<[string, string | undefined]> = [
    ['Yanked', version.yanked === true ? 'yes' : undefined],
    ['License', version.license],
    [
      'Default version',
      version.num === crate.default_version ? undefined : crate.default_version,
    ],
    ['Rust version', version.rust_version],
    ['Edition', version.edition],
    ['Downloads', downloads(crate)],
    ['Repository', crate.repository],
    ['Homepage', crate.homepage],
    ['Documentation', crate.documentation],
    ['Keywords', crate.keywords?.join(', ')],
    ['Categories', crate.categories?.join(', ')],
    ['Features', version.features && Object.keys(version.features).join(', ')],
    ...dependencyFields(dependencies),
    [
      'Published',
      version.created_at &&
        `${version.created_at}${version.published_by ? ` by ${version.published_by.login}` : ''}`,
    ],
  ];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push(`URL: https://crates.io/crates/${crate.name}/${version.num}`);
  const markdown = readme && convertToMarkdown(readme).trim();
  if (markdown) lines.push('', '## README', '', markdown);
  return lines.join('\n');
}

function downloads(crate: Crate): string | undefined {
  if (crate.downloads === undefined) return undefined;
  const recent =
    crate.recent_downloads === undefined
      ? ''
      : ` (${crate.recent_downloads.toLocaleString('en-US')} in the last 90 days)`;
  return `${crate.downloads.toLocaleString('en-US')}${recent}`;
}

/** One line per dependency kind, crates.io's `normal`, `build`, and `dev`. */
function dependencyFields(
  dependencies: ReadonlyArray<Dependency> | undefined,
): Array<[string, string | undefined]> {
  const kinds: Array<[string, string]> = [
    ['normal', 'Dependencies'],
    ['build', 'Build dependencies'],
    ['dev', 'Dev dependencies'],
  ];
  return kinds.map(([kind, label]) => {
    const ofKind = (dependencies ?? []).filter(
      (dependency) => dependency.kind === kind,
    );
    return [
      label,
      ofKind.length === 0
        ? undefined
        : `(${ofKind.length}) ${ofKind
            .map(
              ({ crate_id, req, optional }) =>
                `${crate_id} ${req}${optional ? ' (optional)' : ''}`,
            )
            .join(', ')}`,
    ];
  });
}
