import { z } from 'zod';

import type { GithubFile } from './document';
import { FILE_WIRE, parseGithub, toGithubFile } from './payload';
import type { GithubTreeEntry } from './code-document';

export type GithubBlobPayload = z.infer<typeof BLOB_WIRE>;

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

export type GithubMatchingRef = z.infer<typeof MATCHING_REF_WIRE>;

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

const COMMIT_AUTHOR_WIRE = z
  .object({
    name: z.string(),
    date: z.string(),
  })
  .nullable();

const COMMIT_WIRE = z.object({
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    author: COMMIT_AUTHOR_WIRE,
  }),
  author: z.object({ login: z.string() }).nullable().optional(),
  files: z.array(FILE_WIRE).optional(),
});

const COMMIT_FILES_WIRE = z.object({ files: z.array(FILE_WIRE) });
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

export function parseGithubTree(
  body: string,
): ReadonlyArray<GithubTreeEntry> | undefined {
  return parseGithub(TREE_WIRE, body)?.tree;
}

export function parseGithubRepository(
  body: string,
): GithubRepositoryPayload | undefined {
  const result = parseGithub(REPOSITORY_WIRE, body);
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
  const result = parseGithub(COMMIT_WIRE, body);
  if (!result) return undefined;
  const author = result.author?.login ?? result.commit.author?.name;
  if (author === undefined || result.commit.author === null) return undefined;
  return {
    sha: result.sha,
    message: result.commit.message,
    author,
    authoredAt: result.commit.author.date,
    files: result.files?.map(toGithubFile) ?? [],
  };
}

export function parseGithubCommitFiles(
  body: string,
): ReadonlyArray<GithubFile> | undefined {
  return parseGithub(COMMIT_FILES_WIRE, body)?.files.map(toGithubFile);
}

export function parseGithubMatchingRefs(
  body: string,
): ReadonlyArray<GithubMatchingRef> | undefined {
  return parseGithub(z.array(MATCHING_REF_WIRE), body);
}
