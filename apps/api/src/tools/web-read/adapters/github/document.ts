export type GithubComment = {
  readonly id: number;
  readonly author: string;
  readonly createdAt: string;
  readonly url: string;
  readonly body: string;
};

export type GithubReview = {
  readonly id: number;
  readonly author: string;
  readonly submittedAt: string;
  readonly state: string;
  readonly url: string;
  readonly body: string;
};

export type GithubReviewComment = GithubComment & {
  readonly path: string;
  readonly line: number | null;
  readonly side: string | null;
  readonly inReplyTo: number | null;
};

export type GithubFile = {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly previousFilename?: string;
};

export type GithubChecks =
  | {
      readonly kind: 'loaded';
      readonly passed: number;
      readonly failed: ReadonlyArray<string>;
      readonly pending: number;
      readonly notLoaded: number;
    }
  | { readonly kind: 'unavailable' };

export type GithubIssueDocument = {
  readonly kind: 'issue';
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly author: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly labels: ReadonlyArray<string>;
  readonly url: string;
  readonly body: string | null;
  readonly comments: ReadonlyArray<GithubComment>;
};

export type GithubPullDocument = {
  readonly kind: 'pull';
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly draft: boolean;
  readonly author: string;
  readonly base: string;
  readonly head: string;
  readonly mergeableState: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly labels: ReadonlyArray<string>;
  readonly url: string;
  readonly diffUrl: string;
  readonly body: string | null;
  readonly files: ReadonlyArray<GithubFile>;
  readonly reviews: ReadonlyArray<GithubReview>;
  readonly reviewComments: ReadonlyArray<GithubReviewComment>;
  readonly comments: ReadonlyArray<GithubComment>;
  readonly checks: GithubChecks;
};

export type GithubDocument = GithubIssueDocument | GithubPullDocument;

export function renderGithubDocument(document: GithubDocument): string {
  return document.kind === 'issue'
    ? renderIssue(document)
    : renderPullRequest(document);
}

function renderIssue(document: GithubIssueDocument): string {
  const lines = [
    `# Issue #${document.number}: ${document.title}`,
    '',
    `State: ${document.state}`,
  ];
  if (document.stateReason !== null) {
    lines.push(`State reason: ${document.stateReason}`);
  }
  lines.push(
    `Author: ${document.author}`,
    `Created: ${document.createdAt}`,
    `Updated: ${document.updatedAt}`,
    `Labels: ${formatLabels(document.labels)}`,
    `URL: ${document.url}`,
    '',
    '## Body',
    '',
    formatBody(document.body),
    '',
    `## Comments (${document.comments.length})`,
  );
  appendComments(lines, document.comments);
  return lines.join('\n').trim();
}

function renderPullRequest(document: GithubPullDocument): string {
  const lines = [
    `# Pull Request #${document.number}: ${document.title}`,
    '',
    `State: ${document.state}`,
    `Draft: ${document.draft}`,
    `Author: ${document.author}`,
    `Base: ${document.base}`,
    `Head: ${document.head}`,
    `Reviews: ${formatReviewCounts(document.reviews)}`,
    `Merge state: ${document.mergeableState ?? 'unknown'}`,
    `Checks: ${formatChecks(document.checks)}`,
    `Created: ${document.createdAt}`,
    `Updated: ${document.updatedAt}`,
    `Labels: ${formatLabels(document.labels)}`,
    `URL: ${document.url}`,
    `Diff: ${document.diffUrl}`,
    '',
    '## Body',
    '',
    formatBody(document.body),
  ];
  appendFiles(lines, document.files);
  appendReviews(lines, document.reviews);
  appendReviewComments(lines, document.reviewComments);
  lines.push('', `## Comments (${document.comments.length})`);
  appendComments(lines, document.comments);
  return lines.join('\n').trim();
}

function formatLabels(labels: ReadonlyArray<string>): string {
  return labels.length === 0 ? 'none' : labels.join(', ');
}

function formatBody(body: string | null): string {
  const normalized = normalizeText(body ?? '');
  return normalized || 'No description provided.';
}

function normalizeText(value: string): string {
  return value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\t', '    ')
    .trim();
}

function formatItemBody(body: string, fallback: string): string {
  return normalizeText(body) || fallback;
}

function formatReviewCounts(reviews: ReadonlyArray<GithubReview>): string {
  const latest = new Map<string, GithubReview>();
  for (const review of reviews) {
    if (review.state !== 'APPROVED' && review.state !== 'CHANGES_REQUESTED')
      continue;
    latest.set(review.author, review);
  }
  let approved = 0;
  let changesRequested = 0;
  for (const review of latest.values()) {
    if (review.state === 'APPROVED') approved += 1;
    if (review.state === 'CHANGES_REQUESTED') changesRequested += 1;
  }
  if (approved === 0 && changesRequested === 0) return 'none';
  const counts: Array<string> = [];
  if (approved > 0) counts.push(`${approved} approved`);
  if (changesRequested > 0)
    counts.push(`${changesRequested} changes requested`);
  return `${counts.join(', ')} (latest per reviewer)`;
}

function formatChecks(checks: GithubChecks): string {
  if (checks.kind === 'unavailable') return 'unavailable';
  const parts: Array<string> = [];
  if (checks.passed > 0) parts.push(`${checks.passed} passed`);
  if (checks.failed.length > 0) {
    parts.push(`${checks.failed.length} failed (${checks.failed.join(', ')})`);
  }
  if (checks.pending > 0) parts.push(`${checks.pending} pending`);
  if (checks.notLoaded > 0) parts.push(`${checks.notLoaded} not loaded`);
  return parts.length === 0 ? 'none' : parts.join(', ');
}

function appendFiles(
  lines: Array<string>,
  files: ReadonlyArray<GithubFile>,
): void {
  lines.push('', `## Files (${files.length})`);
  for (const file of files) {
    const renamed =
      file.previousFilename === undefined
        ? ''
        : ` (renamed from ${file.previousFilename})`;
    lines.push(
      `- ${file.filename} (${file.status}, +${file.additions} -${file.deletions})${renamed}`,
    );
  }
}

function appendReviews(
  lines: Array<string>,
  reviews: ReadonlyArray<GithubReview>,
): void {
  lines.push('', `## Reviews (${reviews.length})`);
  for (const review of reviews) {
    appendItemHeader(lines, review.author, review.submittedAt);
    lines.push(
      `ID: ${review.id}`,
      `State: ${review.state}`,
      `URL: ${review.url}`,
      '',
      formatItemBody(review.body, 'No review body.'),
    );
  }
}

function appendReviewComments(
  lines: Array<string>,
  comments: ReadonlyArray<GithubReviewComment>,
): void {
  lines.push('', `## Review Comments (${comments.length})`);
  for (const comment of comments) {
    appendItemHeader(lines, comment.author, comment.createdAt);
    lines.push(`ID: ${comment.id}`);
    if (comment.inReplyTo !== null)
      lines.push(`Reply to: ${comment.inReplyTo}`);
    lines.push(`Location: ${formatLocation(comment)}`);
    if (comment.side !== null) lines.push(`Side: ${comment.side}`);
    lines.push(
      `URL: ${comment.url}`,
      '',
      formatItemBody(comment.body, 'No review comment body.'),
    );
  }
}

function appendComments(
  lines: Array<string>,
  comments: ReadonlyArray<GithubComment>,
): void {
  for (const comment of comments) {
    appendItemHeader(lines, comment.author, comment.createdAt);
    lines.push(
      `ID: ${comment.id}`,
      `URL: ${comment.url}`,
      '',
      formatItemBody(comment.body, 'No comment body.'),
    );
  }
}

function appendItemHeader(
  lines: Array<string>,
  author: string,
  timestamp: string,
): void {
  lines.push('', `### ${author} · ${timestamp}`, '');
}

function formatLocation(comment: GithubReviewComment): string {
  return comment.line === null
    ? comment.path
    : `${comment.path}:${comment.line}`;
}
