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

export type GithubJsonValue =
  | null
  | boolean
  | number
  | string
  | GithubJsonObject
  | Array<GithubJsonValue>;
type GithubJsonObject = { readonly [key: string]: GithubJsonValue };
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

type RawIssueFields = {
  readonly number: number | undefined;
  readonly title: string | undefined;
  readonly state: string | undefined;
  readonly author: string | undefined;
  readonly createdAt: string | undefined;
  readonly updatedAt: string | undefined;
  readonly labels: ReadonlyArray<string> | undefined;
  readonly url: string | undefined;
  readonly stateReason: string | null | undefined;
  readonly body: string | null | undefined;
};
type IssueFields = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly author: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly labels: ReadonlyArray<string>;
  readonly url: string;
  readonly stateReason: string | null;
  readonly body: string | null;
};
type RawPullFields = {
  readonly number: number | undefined;
  readonly title: string | undefined;
  readonly state: string | undefined;
  readonly merged: boolean | undefined;
  readonly draft: boolean | undefined;
  readonly author: string | undefined;
  readonly base: string | undefined;
  readonly head: string | undefined;
  readonly headSha: string | undefined;
  readonly mergeableState: string | null | undefined;
  readonly createdAt: string | undefined;
  readonly updatedAt: string | undefined;
  readonly labels: ReadonlyArray<string> | undefined;
  readonly url: string | undefined;
  readonly body: string | null | undefined;
};
type PullFields = {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly merged: boolean;
  readonly draft: boolean;
  readonly author: string;
  readonly base: string;
  readonly head: string;
  readonly headSha: string;
  readonly mergeableState: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly labels: ReadonlyArray<string>;
  readonly url: string;
  readonly body: string | null;
};

const JSON_VALUE: z.ZodType<GithubJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JSON_VALUE),
    z.record(z.string(), JSON_VALUE),
  ]),
);

export function parseGithubJson(text: string): GithubJsonValue | undefined {
  try {
    return JSON_VALUE.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export function parseIssuePayload(
  value: GithubJsonValue,
  target: GithubThreadTarget,
): Omit<GithubIssueDocument, 'comments'> | undefined {
  const fields = issueFields(value, target);
  if (fields === undefined) return undefined;
  return { kind: 'issue', ...fields };
}

export function parsePullPayload(
  value: GithubJsonValue,
  target: GithubThreadTarget,
): GithubPullPrimary | undefined {
  const fields = pullFields(value, target);
  if (fields === undefined) return undefined;
  return {
    document: pullDocument(fields, target),
    headSha: fields.headSha,
  };
}

function pullDocument(
  fields: PullFields,
  target: GithubThreadTarget,
): GithubPullPrimary['document'] {
  return {
    kind: 'pull',
    number: fields.number,
    title: fields.title,
    state: fields.merged ? 'merged' : fields.state,
    draft: fields.draft,
    author: fields.author,
    base: fields.base,
    head: fields.head,
    mergeableState: fields.mergeableState,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
    labels: fields.labels,
    url: fields.url,
    diffUrl: `https://github.com/${target.owner}/${target.repo}/pull/${target.number}.diff`,
    body: fields.body,
  };
}

export function parseCommentsPage(
  value: GithubJsonValue,
): ReadonlyArray<GithubComment> | undefined {
  return parseItems(value, parseComment);
}

export function parseReviewsPage(
  value: GithubJsonValue,
): ReadonlyArray<GithubReview> | undefined {
  return parseItems(value, parseReview);
}

export function parseReviewCommentsPage(
  value: GithubJsonValue,
): ReadonlyArray<GithubReviewComment> | undefined {
  return parseItems(value, parseReviewComment);
}

export function parseFilesPage(
  value: GithubJsonValue,
): ReadonlyArray<GithubFile> | undefined {
  return parseItems(value, parseFile);
}

export function parseCheckPage(
  value: GithubJsonValue,
  requireTotal: boolean,
): GithubCheckPage | undefined {
  if (!isObject(value) || !Array.isArray(value.check_runs)) return undefined;
  const totalCount = readInteger(value, 'total_count');
  if (requireTotal && (totalCount === undefined || totalCount < 0))
    return undefined;
  const runs: Array<GithubCheckRun> = [];
  for (const item of value.check_runs) {
    if (!isObject(item)) return undefined;
    const name = readString(item, 'name');
    const status = readString(item, 'status');
    const conclusion = readNullableString(item, 'conclusion');
    if (name === undefined || status === undefined || conclusion === undefined)
      return undefined;
    runs.push({ name, status, conclusion });
  }
  return { totalCount, runs };
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
    else if (isPassingConclusion(run.conclusion)) passed += 1;
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

function issueFields(
  value: GithubJsonValue,
  target: GithubThreadTarget,
): IssueFields | undefined {
  if (!isObject(value)) return undefined;
  const fields: RawIssueFields = {
    number: readInteger(value, 'number'),
    title: readString(value, 'title'),
    state: readString(value, 'state'),
    author: readAuthor(value),
    createdAt: readString(value, 'created_at'),
    updatedAt: readString(value, 'updated_at'),
    labels: readLabels(value),
    url: readString(value, 'html_url'),
    stateReason: readNullableString(value, 'state_reason'),
    body: readBody(value, 'body'),
  };
  return validIssueFields(fields, target) ? fields : undefined;
}

function validIssueFields(
  fields: RawIssueFields,
  target: GithubThreadTarget,
): fields is IssueFields {
  return (
    fields.number === target.number &&
    fields.title !== undefined &&
    fields.state !== undefined &&
    fields.author !== undefined &&
    fields.createdAt !== undefined &&
    fields.updatedAt !== undefined &&
    fields.labels !== undefined &&
    fields.url !== undefined &&
    fields.stateReason !== undefined &&
    fields.body !== undefined
  );
}

function pullFields(
  value: GithubJsonValue,
  target: GithubThreadTarget,
): PullFields | undefined {
  if (!isObject(value)) return undefined;
  const fields: RawPullFields = {
    number: readInteger(value, 'number'),
    title: readString(value, 'title'),
    state: readString(value, 'state'),
    merged: readBoolean(value, 'merged'),
    draft: readBoolean(value, 'draft'),
    author: readAuthor(value),
    base: readNestedString(value, 'base', 'ref'),
    head: readNestedString(value, 'head', 'ref'),
    headSha: readNestedString(value, 'head', 'sha'),
    mergeableState: readNullableString(value, 'mergeable_state'),
    createdAt: readString(value, 'created_at'),
    updatedAt: readString(value, 'updated_at'),
    labels: readLabels(value),
    url: readString(value, 'html_url'),
    body: readBody(value, 'body'),
  };
  return validPullFields(fields, target) ? fields : undefined;
}

function validPullFields(
  fields: RawPullFields,
  target: GithubThreadTarget,
): fields is PullFields {
  return (
    fields.number === target.number &&
    fields.title !== undefined &&
    (fields.state === 'open' || fields.state === 'closed') &&
    fields.merged !== undefined &&
    fields.draft !== undefined &&
    fields.author !== undefined &&
    fields.base !== undefined &&
    fields.head !== undefined &&
    fields.headSha !== undefined &&
    fields.mergeableState !== undefined &&
    fields.createdAt !== undefined &&
    fields.updatedAt !== undefined &&
    fields.labels !== undefined &&
    fields.url !== undefined &&
    fields.body !== undefined
  );
}

function parseItems<T>(
  value: GithubJsonValue,
  parse: (value: GithubJsonValue) => T | undefined,
): ReadonlyArray<T> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: Array<T> = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === undefined) return undefined;
    items.push(parsed);
  }
  return items;
}

function parseComment(value: GithubJsonValue): GithubComment | undefined {
  if (!isObject(value)) return undefined;
  const id = readInteger(value, 'id');
  const author = readAuthor(value);
  const createdAt = readString(value, 'created_at');
  const url = readString(value, 'html_url');
  const body = readText(value, 'body');
  return id === undefined ||
    author === undefined ||
    createdAt === undefined ||
    url === undefined ||
    body === undefined
    ? undefined
    : { id, author, createdAt, url, body };
}

function parseReview(value: GithubJsonValue): GithubReview | undefined {
  if (!isObject(value)) return undefined;
  const id = readInteger(value, 'id');
  const author = readAuthor(value);
  const submittedAt = readText(value, 'submitted_at');
  const state = readString(value, 'state');
  const url = readString(value, 'html_url');
  const body = readText(value, 'body');
  return id === undefined ||
    author === undefined ||
    submittedAt === undefined ||
    state === undefined ||
    url === undefined ||
    body === undefined
    ? undefined
    : { id, author, submittedAt, state, url, body };
}

function parseReviewComment(
  value: GithubJsonValue,
): GithubReviewComment | undefined {
  if (!isObject(value)) return undefined;
  const comment = parseComment(value);
  const path = readString(value, 'path');
  const line = readNullableInteger(value, 'line');
  const side = readNullableString(value, 'side');
  const inReplyTo = readNullableInteger(value, 'in_reply_to_id');
  return comment === undefined ||
    path === undefined ||
    line === undefined ||
    side === undefined ||
    inReplyTo === undefined
    ? undefined
    : { ...comment, path, line, side, inReplyTo };
}

function parseFile(value: GithubJsonValue): GithubFile | undefined {
  if (!isObject(value)) return undefined;
  const filename = readString(value, 'filename');
  const status = readString(value, 'status');
  const additions = readInteger(value, 'additions');
  const deletions = readInteger(value, 'deletions');
  const previousFilename = readNullableString(value, 'previous_filename');
  if (
    filename === undefined ||
    status === undefined ||
    additions === undefined ||
    deletions === undefined ||
    previousFilename === undefined
  )
    return undefined;
  return previousFilename === null
    ? { filename, status, additions, deletions }
    : { filename, status, additions, deletions, previousFilename };
}

function readAuthor(value: GithubJsonObject): string | undefined {
  const user = value.user;
  return isObject(user) ? readString(user, 'login') : undefined;
}

function readNestedString(
  value: GithubJsonObject,
  objectKey: string,
  field: string,
): string | undefined {
  const nested = value[objectKey];
  return isObject(nested) ? readString(nested, field) : undefined;
}

function readLabels(
  value: GithubJsonObject,
): ReadonlyArray<string> | undefined {
  if (value.labels === undefined) return [];
  if (!Array.isArray(value.labels)) return undefined;
  const labels: Array<string> = [];
  for (const item of value.labels) {
    if (!isObject(item)) return undefined;
    const label = readString(item, 'name');
    if (label === undefined) return undefined;
    labels.push(label);
  }
  return labels;
}

function readBody(
  value: GithubJsonObject,
  key: string,
): string | null | undefined {
  if (value[key] === null || value[key] === undefined) return null;
  return readString(value, key);
}

function readText(value: GithubJsonObject, key: string): string | undefined {
  return value[key] === null || value[key] === undefined
    ? ''
    : readString(value, key);
}

function readNullableString(
  value: GithubJsonObject,
  key: string,
): string | null | undefined {
  return value[key] === null || value[key] === undefined
    ? null
    : readString(value, key);
}

function readNullableInteger(
  value: GithubJsonObject,
  key: string,
): number | null | undefined {
  return value[key] === null || value[key] === undefined
    ? null
    : readInteger(value, key);
}

function readString(value: GithubJsonObject, key: string): string | undefined {
  const candidate = value[key];
  return isJsonString(candidate) ? candidate : undefined;
}

function readInteger(value: GithubJsonObject, key: string): number | undefined {
  const candidate = value[key];
  return isJsonNumber(candidate) ? candidate : undefined;
}

function readBoolean(
  value: GithubJsonObject,
  key: string,
): boolean | undefined {
  const candidate = value[key];
  return isJsonBoolean(candidate) ? candidate : undefined;
}

function isObject(value: GithubJsonValue): value is GithubJsonObject {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isJsonString(value: GithubJsonValue): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

function isJsonNumber(value: GithubJsonValue): value is number {
  return (
    Object.prototype.toString.call(value) === '[object Number]' &&
    Number.isInteger(value)
  );
}

function isJsonBoolean(value: GithubJsonValue): value is boolean {
  return Object.prototype.toString.call(value) === '[object Boolean]';
}

function isPassingConclusion(conclusion: string | null): boolean {
  return (
    conclusion === 'success' ||
    conclusion === 'neutral' ||
    conclusion === 'skipped'
  );
}
