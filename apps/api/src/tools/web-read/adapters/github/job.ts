import { z } from 'zod';

import { primaryFailure, type WebAdapterOutcome } from '../contract';
import { fencedBlock } from './markdown';
import { NULLABLE, parseGithub } from './payload';
import {
  finishRendered,
  recordSecondaryFailure,
  repoPath,
  requestJson,
  type GithubReadOptions,
  type GithubRequestContext,
} from './request';
import type { GithubJobTarget } from './url';

/** The failure is at the end of a log, so the end is what a read keeps. */
const LOG_TAIL_LINES = 400;
const LOG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/u;
/** What follows an escape character in a color or cursor sequence. */
const CSI_BODY = /^\[[0-?]*[ -/]*[@-~]/u;

const JOB_WIRE = z.object({
  run_id: z.number().int(),
  run_attempt: z.number().int().optional(),
  workflow_name: NULLABLE,
  head_branch: NULLABLE,
  head_sha: z.string(),
  html_url: z.string(),
  status: z.string(),
  conclusion: NULLABLE,
  started_at: NULLABLE,
  completed_at: NULLABLE,
  name: z.string(),
  labels: z.array(z.string()).optional(),
  steps: z
    .array(
      z.object({
        number: z.number().int(),
        name: z.string(),
        status: z.string(),
        conclusion: NULLABLE,
      }),
    )
    .optional(),
});
type Job = z.infer<typeof JOB_WIRE>;
type LogTail = {
  readonly lines: ReadonlyArray<string>;
  readonly total: number;
};

/** The job is primary; its log is a secondary section that GitHub serves only
 *  to a token, through a redirect to signed blob storage. */
export async function readGithubJob(
  target: GithubJobTarget,
  options: GithubReadOptions,
): Promise<WebAdapterOutcome> {
  const context: GithubRequestContext = { ...options, notes: [] };
  const primary = await requestJson(
    `${options.apiOrigin}${repoPath(target)}/actions/jobs/${target.job}`,
    context,
  );
  if (primary.kind === 'failed') return primaryFailure(primary.failure);
  const job = parseGithub(JOB_WIRE, primary.body);
  if (job === undefined) return { kind: 'failed', failure: 'parse' };
  const log = await loadLog(target, context);
  return finishRendered(renderJob(target, job, log), context);
}

async function loadLog(
  target: GithubJobTarget,
  context: GithubRequestContext,
): Promise<LogTail | undefined> {
  if (context.init.authorization === undefined) {
    context.notes.push('log omitted: token required');
    return undefined;
  }
  const result = await requestJson(
    `${context.apiOrigin}${repoPath(target)}/actions/jobs/${target.job}/logs`,
    context,
  );
  if (result.kind === 'failed') {
    recordSecondaryFailure('log', result.failure, context);
    return undefined;
  }
  const tail = tailOfLog(result.body);
  if (tail.total > LOG_TAIL_LINES) {
    context.notes.push(
      `log truncated: the last ${LOG_TAIL_LINES} of ${tail.total} lines`,
    );
  }
  return tail;
}

/** The last lines of a log with each line's timestamp and color codes removed;
 *  the log opens with a byte order mark. */
function tailOfLog(log: string): LogTail {
  const lines = log.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  return {
    lines: lines.slice(-LOG_TAIL_LINES).map(cleanLogLine),
    total: lines.length,
  };
}

function cleanLogLine(line: string): string {
  return line
    .replace(LOG_TIMESTAMP, '')
    .split('\u001b')
    .map((part, index) => (index === 0 ? part : part.replace(CSI_BODY, '')))
    .join('');
}

function renderJob(
  target: GithubJobTarget,
  job: Job,
  log: LogTail | undefined,
): string {
  const fields: Array<[string, string | null | undefined]> = [
    ['Workflow', job.workflow_name],
    ['Status', job.status],
    ['Conclusion', job.conclusion],
    [
      'Run',
      `https://github.com/${target.owner}/${target.repo}/actions/runs/${job.run_id}`,
    ],
    ['Attempt', job.run_attempt?.toString()],
    ['Branch', job.head_branch],
    ['Commit', job.head_sha],
    ['Runner', job.labels?.join(', ')],
    ['Started', job.started_at],
    ['Completed', job.completed_at],
    ['URL', job.html_url],
  ];
  const steps = job.steps ?? [];
  const lines = [`# Job ${target.job}: ${job.name}`, ''];
  for (const [label, value] of fields) {
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push('', `## Steps (${steps.length})`);
  for (const step of steps) {
    lines.push(
      `- ${step.number}. ${step.name} — ${step.conclusion ?? step.status}`,
    );
  }
  if (log !== undefined) lines.push(...logSection(log));
  return lines.join('\n');
}

function logSection(log: LogTail): Array<string> {
  const size =
    log.lines.length < log.total
      ? `last ${log.lines.length} of ${log.total} lines`
      : `${log.total} lines`;
  return [
    '',
    `## Log (${size})`,
    '',
    fencedBlock(log.lines.join('\n'), 'text'),
  ];
}
