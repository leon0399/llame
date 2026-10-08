import { z } from 'zod';

import type { HuggingfaceWebAdapterConfig } from '../../../../instance-config/llame-config';
import type { WebRequestInit } from '../../http-client';
import {
  loadSection,
  parseJsonBody,
  primaryFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from '../contract';

/** The Hub; repository metadata and public files need no token. */
export const HUGGINGFACE_ORIGIN = 'https://huggingface.co';

const JSON_INIT: WebRequestInit = { accept: 'application/json' };
const README_INIT: WebRequestInit = {
  accept: 'text/markdown, text/plain;q=0.9',
};

type RepoKind = 'models' | 'datasets' | 'spaces';
type HuggingfaceTarget = { readonly kind: RepoKind; readonly id: string };

const OWNER = '[A-Za-z0-9][A-Za-z0-9._-]{0,95}';
const NAME = '[A-Za-z0-9._-]{1,96}';
const REPO_PATH = new RegExp(
  `^/(?:(datasets|spaces)/)?(${OWNER})/(${NAME})$`,
  'u',
);
/** First path segments that are Hub pages rather than model owners, so a
 *  read of `/docs/transformers` or `/blog/x` costs no API request. */
const RESERVED_OWNERS = {
  api: true,
  blog: true,
  changelog: true,
  chat: true,
  collections: true,
  datasets: true,
  docs: true,
  hardware: true,
  inference: true,
  'inference-endpoints': true,
  join: true,
  kernels: true,
  learn: true,
  login: true,
  mcp: true,
  models: true,
  new: true,
  organizations: true,
  papers: true,
  posts: true,
  pricing: true,
  search: true,
  settings: true,
  spaces: true,
  tasks: true,
} as const satisfies Readonly<Record<string, true>>;

/** Second segments that are an owner's listing pages (`/meta-llama/models`). */
const OWNER_LISTINGS = {
  collections: true,
  datasets: true,
  models: true,
  papers: true,
  spaces: true,
} as const satisfies Readonly<Record<string, true>>;

/** Fields requested per repository kind; the Hub rejects a field a kind
 *  does not have. */
const EXPAND: Readonly<Record<RepoKind, ReadonlyArray<string>>> = {
  models: ['library_name', 'pipeline_tag', 'downloads', 'gated', 'safetensors'],
  datasets: ['downloads', 'gated'],
  spaces: ['sdk'],
};
const SHARED_EXPAND = [
  'cardData',
  'createdAt',
  'lastModified',
  'likes',
  'sha',
  'tags',
];

/** The Hub sends an expanded field it has no value for as `null`. */
const absent = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

const REPOSITORY = z.object({
  id: z.string(),
  sha: z.string().nullish().transform(absent),
  gated: z
    .union([z.literal(false), z.string()])
    .nullish()
    .transform(absent),
  likes: z.number().int().nullish().transform(absent),
  downloads: z.number().int().nullish().transform(absent),
  tags: z.array(z.string()).nullish().transform(absent),
  createdAt: z.string().nullish().transform(absent),
  lastModified: z.string().nullish().transform(absent),
  library_name: z.string().nullish().transform(absent),
  pipeline_tag: z.string().nullish().transform(absent),
  sdk: z.string().nullish().transform(absent),
  safetensors: z.object({ total: z.number() }).nullish().transform(absent),
  cardData: z
    .object({
      license: z.string().or(z.array(z.string())).nullish().transform(absent),
    })
    .nullish()
    .transform(absent),
});
type Repository = z.infer<typeof REPOSITORY>;

/** A model card's YAML front matter, which the metadata lines already cover. */
const FRONT_MATTER = /^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u;

const KIND_LABEL: Readonly<Record<RepoKind, string>> = {
  models: 'Model',
  datasets: 'Dataset',
  spaces: 'Space',
};

/** Matches Hub model, dataset, and Space repository pages. */
export function parseHuggingfaceUrl(
  source: URL,
): HuggingfaceTarget | undefined {
  if (source.protocol !== 'https:' || source.host !== 'huggingface.co') {
    return undefined;
  }
  const match = REPO_PATH.exec(source.pathname);
  if (match === null) return undefined;
  const [, prefix, owner = '', name = ''] = match;
  const kind: RepoKind =
    prefix === 'datasets' || prefix === 'spaces' ? prefix : 'models';
  if (
    kind === 'models' &&
    (Object.hasOwn(RESERVED_OWNERS, owner) ||
      Object.hasOwn(OWNER_LISTINGS, name))
  ) {
    return undefined;
  }
  return { kind, id: `${owner}/${name}` };
}

/** Creates the native Hugging Face Hub adapter. */
export function createHuggingfaceAdapter(
  config: HuggingfaceWebAdapterConfig,
  options: { readonly origin?: string } = {},
): WebAdapter {
  const origin = options.origin ?? HUGGINGFACE_ORIGIN;
  return {
    id: config.id,
    route: 'native',
    match: (source) => parseHuggingfaceUrl(source) !== undefined,
    read: (source, io) =>
      readRepository(parseHuggingfaceUrl(source)!, io, origin),
  };
}

/** Repository metadata is primary; the README is a secondary section. */
async function readRepository(
  target: HuggingfaceTarget,
  io: WebAdapterIo,
  origin: string,
): Promise<WebAdapterOutcome> {
  const expand = [...SHARED_EXPAND, ...EXPAND[target.kind]]
    .map((field) => `expand[]=${field}`)
    .join('&');
  const fetched = await io.fetch(
    `${origin}/api/${target.kind}/${target.id}?${expand}`,
    JSON_INIT,
  );
  if ('type' in fetched) return primaryFailure(fetched);
  const repository = parseJsonBody(fetched.body, REPOSITORY);
  if (repository === undefined) return { kind: 'failed', failure: 'parse' };

  const notes: Array<string> = [];
  const readmeUrl = `${origin}${pagePath(target)}/raw/${repository.sha ?? 'main'}/README.md`;
  const readme = await loadSection(
    'readme',
    io.fetch(readmeUrl, README_INIT),
    notes,
  );
  if ('fatal' in readme) return primaryFailure(readme.fatal);
  return {
    kind: 'rendered',
    content: renderRepository(target, repository, readme.body),
    mediaType: 'text/markdown',
    notes,
  };
}

function renderRepository(
  target: HuggingfaceTarget,
  repository: Repository,
  readme: string | undefined,
): string {
  const license = repository.cardData?.license;
  const fields: Array<[string, string | number | undefined]> = [
    [
      'Kind',
      [
        KIND_LABEL[target.kind],
        repository.pipeline_tag,
        repository.library_name,
      ]
        .filter((part) => part !== undefined)
        .join(' · '),
    ],
    ['License', Array.isArray(license) ? license.join(', ') : license],
    ['Gated', repository.gated || undefined],
    ['SDK', repository.sdk],
    ['Parameters', repository.safetensors?.total.toLocaleString('en-US')],
    ['Downloads (last 30 days)', repository.downloads?.toLocaleString('en-US')],
    ['Likes', repository.likes?.toLocaleString('en-US')],
    ['Tags', repository.tags?.join(', ')],
    ['Created', repository.createdAt],
    ['Updated', repository.lastModified],
    ['Revision', repository.sha],
  ];
  const lines = [`# ${repository.id}`, ''];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push(`URL: ${HUGGINGFACE_ORIGIN}${pagePath(target)}`);
  const card = readme?.replace(FRONT_MATTER, '').trim();
  if (card) lines.push('', '## README', '', card);
  return lines.join('\n');
}

function pagePath(target: HuggingfaceTarget): string {
  return target.kind === 'models'
    ? `/${target.id}`
    : `/${target.kind}/${target.id}`;
}
