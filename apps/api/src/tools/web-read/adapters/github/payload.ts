import { z } from 'zod';

import type {
  GithubChecks,
  GithubComment,
  GithubFile,
  GithubIssueDocument,
  GithubPullDocument,
  GithubReview,
  GithubReviewComment,
} from './document';
import type { GithubThreadTarget } from './url';

export type GithubPullPrimary = {
  readonly document: Omit<
    GithubPullDocument,
    'comments' | 'reviews' | 'reviewComments' | 'files' | 'checks'
  >;
  readonly headSha: string;
};
export type GithubCheckRun = {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
};
export type GithubCheckPage = {
  readonly totalCount?: number;
  readonly runs: ReadonlyArray<GithubCheckRun>;
};

type User = string;

const USER: z.ZodType<User> = z
  .object({ login: z.string() })
  .nullable()
  .optional()
  .transform((user) => user?.login ?? 'ghost');
const TEXT = z
  .string()
  .nullish()
  .transform((value) => value ?? '');
const BODY = z
  .string()
  .nullish()
  .transform((value) => value ?? null);
const NULLABLE = z
  .string()
  .nullish()
  .transform((value) => value ?? null);
const LABELS = z
  .array(z.object({ name: z.string() }))
  .optional()
  .transform((labels = []) => labels.map(({ name }) => name));
const COMMENT_WIRE = z.object({
  id: z.number().int(),
  user: USER,
  created_at: z.string(),
  html_url: z.string(),
  body: TEXT,
});
const REVIEW_WIRE = z.object({
  id: z.number().int(),
  user: USER,
  submitted_at: TEXT,
  state: z.string(),
  html_url: z.string(),
  body: TEXT,
});
const REVIEW_COMMENT_WIRE = COMMENT_WIRE.extend({
  path: z.string(),
  line: z
    .number()
    .int()
    .nullish()
    .transform((value) => value ?? null),
  side: NULLABLE,
  in_reply_to_id: z
    .number()
    .int()
    .nullish()
    .transform((value) => value ?? null),
});
export const FILE_WIRE = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  previous_filename: z.string().optional(),
});
const ISSUE_WIRE = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  state_reason: NULLABLE,
  user: USER,
  created_at: z.string(),
  updated_at: z.string(),
  labels: LABELS,
  html_url: z.string(),
  body: BODY,
});
const PULL_WIRE = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  draft: z.boolean(),
  user: USER,
  base: z.object({ ref: z.string() }),
  head: z.object({ ref: z.string(), sha: z.string() }),
  mergeable_state: NULLABLE,
  created_at: z.string(),
  updated_at: z.string(),
  labels: LABELS,
  html_url: z.string(),
  body: BODY,
});
const CHECK_RUN_WIRE = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: NULLABLE,
});
const CHECK_PAGE_OPTIONAL = z.object({
  total_count: z.number().int().optional(),
  check_runs: z.array(CHECK_RUN_WIRE),
});
const CHECK_PAGE_REQUIRED = CHECK_PAGE_OPTIONAL.extend({
  total_count: z.number().int().nonnegative(),
});

export function parseGithub<T>(
  schema: z.ZodType<T>,
  body: string,
): T | undefined {
  try {
    const result = schema.safeParse(JSON.parse(body));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function parseIssuePayload(
  body: string,
  target: GithubThreadTarget,
): Omit<GithubIssueDocument, 'comments'> | undefined {
  const issue = parseGithub(ISSUE_WIRE, body);
  if (issue === undefined || issue.number !== target.number) return undefined;
  return {
    kind: 'issue',
    number: issue.number,
    title: issue.title,
    state: issue.state,
    stateReason: issue.state_reason,
    author: issue.user,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    labels: issue.labels,
    url: issue.html_url,
    body: issue.body,
  };
}

export function parsePullPayload(
  body: string,
  target: GithubThreadTarget,
): GithubPullPrimary | undefined {
  const pull = parseGithub(PULL_WIRE, body);
  if (pull === undefined || pull.number !== target.number) return undefined;
  return {
    document: {
      kind: 'pull',
      number: pull.number,
      title: pull.title,
      state: pull.merged ? 'merged' : pull.state,
      draft: pull.draft,
      author: pull.user,
      base: pull.base.ref,
      head: pull.head.ref,
      mergeableState: pull.mergeable_state,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      labels: pull.labels,
      url: pull.html_url,
      diffUrl: `https://github.com/${target.owner}/${target.repo}/pull/${target.number}.diff`,
      body: pull.body,
    },
    headSha: pull.head.sha,
  };
}

export function parseCommentsPage(
  body: string,
): ReadonlyArray<GithubComment> | undefined {
  const comments = parseGithub(z.array(COMMENT_WIRE), body);
  return comments?.map((comment) => ({
    id: comment.id,
    author: comment.user,
    createdAt: comment.created_at,
    url: comment.html_url,
    body: comment.body,
  }));
}

export function parseReviewsPage(
  body: string,
): ReadonlyArray<GithubReview> | undefined {
  const reviews = parseGithub(z.array(REVIEW_WIRE), body);
  return reviews?.map((review) => ({
    id: review.id,
    author: review.user,
    submittedAt: review.submitted_at,
    state: review.state,
    url: review.html_url,
    body: review.body,
  }));
}

export function parseReviewCommentsPage(
  body: string,
): ReadonlyArray<GithubReviewComment> | undefined {
  const comments = parseGithub(z.array(REVIEW_COMMENT_WIRE), body);
  return comments?.map((comment) => ({
    id: comment.id,
    author: comment.user,
    createdAt: comment.created_at,
    url: comment.html_url,
    body: comment.body,
    path: comment.path,
    line: comment.line,
    side: comment.side,
    inReplyTo: comment.in_reply_to_id,
  }));
}

export function parseFilesPage(
  body: string,
): ReadonlyArray<GithubFile> | undefined {
  const files = parseGithub(z.array(FILE_WIRE), body);
  return files?.map(toGithubFile);
}

export function toGithubFile(file: z.infer<typeof FILE_WIRE>): GithubFile {
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

export function parseCheckPage(
  body: string,
  requireTotal: boolean,
): GithubCheckPage | undefined {
  const schema = requireTotal ? CHECK_PAGE_REQUIRED : CHECK_PAGE_OPTIONAL;
  const page = parseGithub(schema, body);
  if (page === undefined) return undefined;
  return {
    totalCount: page.total_count,
    runs: page.check_runs.map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
    })),
  };
}

export function countGithubChecks(
  runs: ReadonlyArray<GithubCheckRun>,
  totalCount: number | undefined,
): GithubChecks {
  if (totalCount === undefined) return { kind: 'unavailable' };
  let passed = 0;
  let pending = 0;
  const failed: Array<string> = [];
  for (const run of runs) {
    if (run.status !== 'completed') pending += 1;
    else if (
      run.conclusion === 'success' ||
      run.conclusion === 'neutral' ||
      run.conclusion === 'skipped'
    )
      passed += 1;
    else failed.push(run.name);
  }
  return {
    kind: 'loaded',
    passed,
    failed,
    pending,
    notLoaded: Math.max(0, totalCount - runs.length),
  };
}
