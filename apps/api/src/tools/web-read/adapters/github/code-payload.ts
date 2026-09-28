import { z } from 'zod';

import type { GithubFile } from './document';

export type GithubBlobPayload = {
  readonly content: string;
  readonly encoding: string;
  readonly size?: number;
};

export type GithubTreePayload = {
  readonly entries: ReadonlyArray<{
    readonly path: string;
    readonly type: 'blob' | 'tree' | 'commit';
  }>;
};

export type GithubRepositoryPayload = {
  readonly description: string | null;
  readonly defaultBranch: string;
  readonly visibility: string;
  readonly language: string | null;
};

export type GithubCommitPayload = {
  readonly sha: string;
  readonly message: string;
  readonly author: string;
  readonly authoredAt: string;
  readonly files: ReadonlyArray<GithubFile>;
};

export type GithubMatchingRef = {
  readonly ref: string;
};

const BLOB_WIRE = z.object({
  content: z.string(),
  encoding: z.string(),
  size: z.number().int().nonnegative().optional(),
});

const TREE_ENTRY_WIRE = z.object({
  path: z.string(),
  type: z.enum(['blob', 'tree', 'commit']),
});

const TREE_WIRE = z.object({
  tree: z.array(TREE_ENTRY_WIRE),
});

const REPOSITORY_WIRE = z.object({
  description: z.string().nullable().optional(),
  default_branch: z.string(),
  visibility: z.string(),
  language: z.string().nullable().optional(),
});

const FILE_WIRE = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  previous_filename: z.string().optional(),
});

const COMMIT_AUTHOR_WIRE = z
  .object({
    name: z.string(),
    date: z.string(),
  })
  .nullable()
  .optional();

const COMMIT_WIRE = z.object({
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    author: COMMIT_AUTHOR_WIRE,
  }),
  author: z.object({ login: z.string() }).nullable().optional(),
  files: z.array(FILE_WIRE).optional(),
});

const MATCHING_REF_WIRE = z.object({ ref: z.string() });

export type GithubBlobResult =
  | { readonly kind: 'blob'; readonly payload: GithubBlobPayload }
  | { readonly kind: 'directory' };

export function parseGithubBlob(body: string): GithubBlobResult | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (Array.isArray(value)) return { kind: 'directory' };
  const result = BLOB_WIRE.safeParse(value);
  return result.success ? { kind: 'blob', payload: result.data } : undefined;
}

export function parseGithubTree(body: string): GithubTreePayload | undefined {
  const result = parseJson(TREE_WIRE, body);
  if (!result) return undefined;
  return { entries: result.tree };
}

export function parseGithubRepository(
  body: string,
): GithubRepositoryPayload | undefined {
  const result = parseJson(REPOSITORY_WIRE, body);
  if (!result) return undefined;
  return {
    description: result.description ?? null,
    defaultBranch: result.default_branch,
    visibility: result.visibility,
    language: result.language ?? null,
  };
}

export function parseGithubCommit(
  body: string,
): GithubCommitPayload | undefined {
  const result = parseJson(COMMIT_WIRE, body);
  if (!result || result.commit.author === undefined) return undefined;
  const author = result.author?.login ?? result.commit.author?.name;
  if (author === undefined) return undefined;
  return {
    sha: result.sha,
    message: result.commit.message,
    author,
    authoredAt: result.commit.author?.date ?? '',
    files: result.files?.map(toGithubFile) ?? [],
  };
}

export function parseGithubMatchingRefs(
  body: string,
): ReadonlyArray<GithubMatchingRef> | undefined {
  const result = parseJson(z.array(MATCHING_REF_WIRE), body);
  return result?.map(({ ref }) => ({ ref }));
}

function parseJson<T>(schema: z.ZodType<T>, body: string): T | undefined {
  try {
    const result = schema.safeParse(JSON.parse(body));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function toGithubFile(file: z.infer<typeof FILE_WIRE>): GithubFile {
  return file.previous_filename === undefined
    ? {
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      }
    : {
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        previousFilename: file.previous_filename,
      };
}
