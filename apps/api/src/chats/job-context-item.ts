/** A settled job notice authored for the first dispatch that receives it. */

import { neutralizeReservedDelimiters } from '@workspace/runtime-safety';

import { type ChatJob } from '../db/schema';
import { formatJobLocator, jobArtifactLocatorOf } from '../jobs/job-locator';
import { loadPackagedTemplate } from '../prompts/template-engine';
import { createRenderedContextItem } from './context-item-shared';
import { type AuthoredContextItemPart } from './context-item';

export type JobNoticeOutput = {
  readonly name: string;
  /** Owner-scoped and redacted by the caller before it reaches this producer. */
  readonly text: string;
};

const renderJobNoticeTemplate = loadPackagedTemplate<{
  readonly locator: string;
  readonly executor: string;
  readonly state: string;
  readonly elapsed: string;
  readonly exitDetail: string | undefined;
  readonly stoppedBy: string | undefined;
  readonly artifactLocator: string | undefined;
  readonly hostDirectory: string | undefined;
  readonly outputs: ReadonlyArray<JobNoticeOutput>;
}>(__dirname, 'job-notice');

/**
 * Build a context item from the immutable, already owner-read settlement and
 * output snapshot. Output bytes are rendered only; the semantic payload keeps
 * job facts and output names, never output prose.
 */
export function createJobNoticeItem(input: {
  readonly runId: string;
  readonly job: ChatJob;
  readonly outputs: ReadonlyArray<JobNoticeOutput>;
  /** Verified artifact cache directory; present only when host files exist. */
  readonly hostDirectory?: string;
}): AuthoredContextItemPart {
  const { job } = input;
  const locator = formatJobLocator(job.executor, job.seq);

  const artifactLocator = jobArtifactLocatorOf(job);

  const elapsedMs = Math.max(
    0,
    (job.settledAt ?? new Date()).getTime() - job.startedAt.getTime(),
  );

  const payload = jobNoticePayload({
    job,
    locator,
    elapsedMs,
    artifactLocator,
    outputs: input.outputs,
  });

  return createRenderedContextItem({
    producer: 'job',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderJobNoticeBody({
      job,
      locator,
      elapsedMs,
      artifactLocator,
      hostDirectory: input.hostDirectory,
      outputs: input.outputs,
    }),
  });
}

function jobNoticePayload(input: {
  readonly job: ChatJob;
  readonly locator: string;
  readonly elapsedMs: number;
  readonly artifactLocator: string | undefined;
  readonly outputs: ReadonlyArray<JobNoticeOutput>;
}) {
  const { job } = input;

  return {
    jobId: job.id,
    locator: input.locator,
    executor: job.executor,
    state: job.state,
    elapsedMs: input.elapsedMs,
    ...(job.result?.exitCode !== undefined && {
      exitCode: job.result.exitCode,
    }),
    ...(job.result?.signal !== undefined && { signal: job.result.signal }),
    ...(job.result?.outcomeUnknown !== undefined && {
      outcomeUnknown: job.result.outcomeUnknown,
    }),
    ...(job.state === 'cancelled' &&
      job.stoppedBy !== null && { stoppedBy: job.stoppedBy }),
    ...(input.artifactLocator !== undefined && {
      artifactLocator: input.artifactLocator,
    }),
    outputNames: input.outputs.map(({ name }) => name),
  };
}

function renderJobNoticeBody(input: {
  readonly job: ChatJob;
  readonly locator: string;
  readonly elapsedMs: number;
  readonly artifactLocator: string | undefined;
  readonly hostDirectory: string | undefined;
  readonly outputs: ReadonlyArray<JobNoticeOutput>;
}): string {
  const { job } = input;

  const exitDetail =
    job.result?.exitCode !== undefined && job.result.exitCode !== null
      ? `exit code ${job.result.exitCode}`
      : job.result?.signal
        ? `signal ${job.result.signal}`
        : job.result?.outcomeUnknown
          ? 'outcome unknown'
          : undefined;

  return renderJobNoticeTemplate({
    locator: input.locator,
    executor: job.executor,
    state: job.state,
    elapsed: formatElapsed(input.elapsedMs),
    exitDetail,
    stoppedBy:
      job.state === 'cancelled' ? (job.stoppedBy ?? undefined) : undefined,
    artifactLocator: input.artifactLocator,
    hostDirectory:
      input.hostDirectory === undefined
        ? undefined
        : neutralizeReservedDelimiters(input.hostDirectory),
    outputs: input.outputs.map(({ name, text }) => ({
      name,
      text: neutralizeReservedDelimiters(text.slice(-2000)),
    })),
  });
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);

  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
