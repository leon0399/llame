import { parsePathScheme } from '@workspace/native-file-tools';

import { type ChatJob } from '../db/schema';
import { formatArtifactLocator } from '../tools/artifacts/locator';
import { TOOL_ID_PATTERN } from '../tools/tool-id';

/**
 * The `job://` locator grammar (background-jobs "A job has a locator scoped to
 * its Chat"). `job://<executor>-<n>` names one job of the current Chat and
 * `job://<executor>-<n>/<output>` names one of its outputs. `<n>` is the artifact
 * number that the job reserved at its start, so the grammar matches the
 * `artifact://` one and a job and its artifact share a number.
 */

export const JOB_SCHEME = 'job';

/** The largest `<n>` a Postgres `integer` column holds. */
const JOB_SEQ_MAX = 2_147_483_647;

export type JobLocator = {
  readonly executor: string;
  readonly seq: number;
  /** The output name, or undefined for the job record. */
  readonly output: string | undefined;
};

const NAME_SOURCE = TOOL_ID_PATTERN.source.slice(1, -1);

const LOCATOR = new RegExp(
  `^(${NAME_SOURCE})-([1-9]\\d*)(?:/(${NAME_SOURCE}))?$`,
  'u',
);

export function formatJobLocator(
  executor: string,
  seq: number,
  output?: string,
): string {
  const locator = `${JOB_SCHEME}://${executor}-${seq}`;

  return output === undefined ? locator : `${locator}/${output}`;
}

/** The locator of a job record. */
export function jobLocatorOf(job: Pick<ChatJob, 'executor' | 'seq'>): string {
  return formatJobLocator(job.executor, job.seq);
}

/** The artifact locator of a job, when its output is stored as an artifact. */
export function jobArtifactLocatorOf(
  job: Pick<ChatJob, 'executor' | 'seq' | 'artifactId'>,
): string | undefined {
  return job.artifactId === null
    ? undefined
    : formatArtifactLocator(job.executor, job.seq);
}

/** Parse a whole locator; the scheme matches without case. */
export function parseJobLocatorText(text: string): JobLocator | undefined {
  const scheme = parsePathScheme(text);

  if (scheme?.scheme !== JOB_SCHEME) return undefined;
  const match = LOCATOR.exec(scheme.rest);

  if (match === null) return undefined;
  const seq = Number(match[2]);

  if (!Number.isSafeInteger(seq) || seq > JOB_SEQ_MAX) return undefined;

  return { executor: match[1], seq, output: match[3] };
}
