import { z } from 'zod';

import type { NpmWebAdapterConfig } from '../../../../instance-config/llame-config';
import type {
  WebFetchFailure,
  WebRequestInit,
  WebResponse,
} from '../../http-client';
import {
  isFatalAdapterFailure,
  omissionNote,
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';

/** The public npm registry; version documents and dist-tags need no key. */
export const NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org';
/** The npm-mirroring CDN that serves a published version's files; unlike
 *  unpkg it keeps a legacy mixed-case name's case. */
export const NPM_FILES_ORIGIN = 'https://cdn.jsdelivr.net/npm';

const JSON_INIT: WebRequestInit = { accept: 'application/json' };
const README_INIT: WebRequestInit = {
  accept: 'text/markdown, text/plain;q=0.9',
};

type NpmTarget = { readonly name: string; readonly version?: string };

/** npm's package-name charset, optionally scoped, at most 214 characters. */
const NAME = String.raw`(?:@[a-z0-9~-][a-z0-9._~-]*/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*`;
const PACKAGE_PATH = new RegExp(
  `^/package/(${NAME})(?:/v/([0-9A-Za-z][0-9A-Za-z.+-]{0,255}))?$`,
  'u',
);
const MAX_NAME_LENGTH = 214;

/** Skips a value of an unexpected shape, so one legacy or malformed field
 *  never costs the whole manifest. */
const SKIPPED = z.unknown().transform(() => undefined);
const PERSON = z
  .string()
  .or(z.object({ name: z.string() }).transform(({ name }) => name))
  .or(SKIPPED);
const DEPENDENCIES = z.record(z.string(), z.string()).or(SKIPPED).optional();
const TEXT = z.string().or(SKIPPED).optional();

/** `GET /{name}/{version}`: one published version's manifest. */
const VERSION_DOCUMENT = z.object({
  name: z.string(),
  version: z.string(),
  description: TEXT,
  license: z
    .string()
    .or(z.object({ type: z.string() }).transform(({ type }) => type))
    .or(SKIPPED)
    .optional(),
  homepage: TEXT,
  repository: z
    .string()
    .or(z.object({ url: z.string() }).transform(({ url }) => url))
    .or(SKIPPED)
    .optional(),
  deprecated: TEXT,
  // Published before npm normalized it, `engines` may be an array.
  engines: z
    .record(z.string(), z.string())
    .transform((engines) => entries(engines, ' '))
    .or(z.array(z.string()).transform((engines) => engines.join(', ')))
    .or(SKIPPED)
    .optional(),
  dependencies: DEPENDENCIES,
  peerDependencies: DEPENDENCIES,
  maintainers: z
    .array(PERSON)
    .transform((people) => people.filter((person) => person !== undefined))
    .or(SKIPPED)
    .optional(),
  dist: z.object({ tarball: z.string() }).or(SKIPPED).optional(),
});
type VersionDocument = z.infer<typeof VERSION_DOCUMENT>;

const DIST_TAGS = z.record(z.string(), z.string());

/** Matches `npmjs.com/package/{name}` and `/package/{name}/v/{version}`. */
export function parseNpmUrl(source: URL): NpmTarget | undefined {
  if (
    source.protocol !== 'https:' ||
    (source.host !== 'www.npmjs.com' && source.host !== 'npmjs.com')
  ) {
    return undefined;
  }
  // `encodeURIComponent`-built links spell a scope's `@` and `/` escaped.
  const match = PACKAGE_PATH.exec(
    source.pathname.replaceAll(/%40/giu, '@').replaceAll(/%2F/giu, '/'),
  );
  const name = match?.[1];
  if (name === undefined || name.length > MAX_NAME_LENGTH) return undefined;
  const version = match?.[2];
  return version === undefined ? { name } : { name, version };
}

/** Creates the native npm adapter. */
export function createNpmAdapter(
  config: NpmWebAdapterConfig,
  options: {
    readonly registryOrigin?: string;
    readonly filesOrigin?: string;
  } = {},
): WebAdapter {
  const origins = {
    registry: options.registryOrigin ?? NPM_REGISTRY_ORIGIN,
    files: options.filesOrigin ?? NPM_FILES_ORIGIN,
  };
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseNpmUrl(source) !== undefined,
    read: (source, io) => readPackage(parseNpmUrl(source)!, io, origins),
  };
}

/** The version manifest is primary; dist-tags and the README are secondary
 *  sections whose failure leaves an omission note. */
async function readPackage(
  target: NpmTarget,
  io: WebAdapterIo,
  origins: { readonly registry: string; readonly files: string },
): Promise<WebAdapterOutcome> {
  const fetched = await io.fetch(
    `${origins.registry}/${target.name}/${target.version ?? 'latest'}`,
    JSON_INIT,
  );
  if ('type' in fetched) return primaryFailure(fetched);
  const manifest = parseJson(fetched.body, VERSION_DOCUMENT);
  if (manifest === undefined) return { kind: 'failed', failure: 'parse' };

  const notes: Array<string> = [];
  const tagsUrl = `${origins.registry}/-/package/${manifest.name}/dist-tags`;
  const tags = await loadSection(
    'dist-tags',
    io.fetch(tagsUrl, JSON_INIT),
    notes,
  );
  if ('fatal' in tags) return primaryFailure(tags.fatal);
  // A spent call deadline cannot be beaten by another request, so the README
  // is skipped with the note its own timed-out request would leave.
  const readmeUrl = `${origins.files}/${manifest.name}@${manifest.version}/README.md`;
  if (tags.spent !== undefined) notes.push(omissionNote('readme', tags.spent));
  const readme =
    tags.spent === undefined
      ? await loadSection('readme', io.fetch(readmeUrl, README_INIT), notes)
      : {};
  if ('fatal' in readme) return primaryFailure(readme.fatal);

  return {
    kind: 'rendered',
    content: renderPackage(
      manifest,
      parseDistTags(tags.body, notes),
      readme.body,
    ),
    mediaType: 'text/markdown',
    notes,
  };
}

function parseDistTags(
  body: string | undefined,
  notes: Array<string>,
): Readonly<Record<string, string>> | undefined {
  if (body === undefined) return undefined;
  const tags = parseJson(body, DIST_TAGS);
  if (tags === undefined) notes.push('dist-tags omitted: parse');
  return tags;
}

/**
 * A secondary section's body, or none with an omission note. A call deadline
 * keeps what already arrived and is returned as `spent`, so later sections
 * are skipped with the same note; any other call-ending failure is returned
 * so the read ends, as GitHub's secondary sections do.
 */
async function loadSection(
  section: string,
  request: Promise<WebResponse | WebFetchFailure>,
  notes: Array<string>,
): Promise<
  | { readonly body?: string; readonly spent?: WebFetchFailure }
  | { readonly fatal: WebFetchFailure }
> {
  const fetched = await request;
  if (!('type' in fetched)) return { body: fetched.body };
  if (fetched.type === 'call_timeout') {
    notes.push(omissionNote(section, fetched));
    return { spent: fetched };
  }
  if (isFatalAdapterFailure(fetched)) return { fatal: fetched };
  notes.push(omissionNote(section, fetched));
  return {};
}

function renderPackage(
  manifest: VersionDocument,
  distTags: Readonly<Record<string, string>> | undefined,
  readme: string | undefined,
): string {
  const lines = [`# ${manifest.name}@${manifest.version}`, ''];
  const description = manifest.description?.trim();
  if (description) lines.push(description, '');

  const fields: Array<[string, string | undefined]> = [
    ['Deprecated', manifest.deprecated],
    ['License', manifest.license],
    ['Homepage', manifest.homepage],
    ['Repository', repositoryUrl(manifest.repository)],
    ['Dist-tags', distTags && entries(distTags, ' ')],
    ['Engines', manifest.engines],
    ['Dependencies', dependencyList(manifest.dependencies)],
    ['Peer dependencies', dependencyList(manifest.peerDependencies)],
    ['Maintainers', manifest.maintainers?.join(', ')],
    ['Tarball', manifest.dist?.tarball],
  ];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push(
    `URL: https://www.npmjs.com/package/${manifest.name}/v/${manifest.version}`,
  );
  if (readme?.trim()) lines.push('', '## README', '', readme.trim());
  return lines.join('\n');
}

function dependencyList(
  dependencies: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (dependencies === undefined) return undefined;
  const count = Object.keys(dependencies).length;
  return count === 0 ? undefined : `(${count}) ${entries(dependencies, '@')}`;
}

function entries(
  record: Readonly<Record<string, string>>,
  separator: string,
): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join(', ');
}

/** Publish normalizes `repository` to a `git+https://…git` URL; render the
 *  browsable form. */
function repositoryUrl(url: string | undefined): string | undefined {
  return url
    ?.replace(/^git\+/u, '')
    .replace(/^(?:git:\/\/|ssh:\/\/git@)/u, 'https://')
    .replace(/\.git$/u, '');
}

function parseJson<T>(body: string, schema: z.ZodType<T>): T | undefined {
  try {
    return schema.safeParse(JSON.parse(body)).data;
  } catch {
    return undefined;
  }
}
