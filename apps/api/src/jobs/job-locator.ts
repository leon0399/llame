import { type ChatJob } from '../db/schema';
import {
  formatArtifactLocator,
  parseNumberedLocator,
} from '../tools/artifacts/locator';

/**
 * The `job://` locator grammar (background-jobs "A job has a locator scoped to
 * its Chat"). `job://<executor>-<n>` names one job of the current Chat and
 * `job://<executor>-<n>/<output>` names one of its outputs. `<n>` is the artifact
 * number that the job reserved at its start, so the grammar matches the
 * `artifact://` one and a job and its artifact share a number.
 */

export const JOB_SCHEME = 'job';

export type JobLocator = {
  readonly executor: string;
  readonly seq: number;
  /** The output name, or undefined for the job record. */
  readonly output: string | undefined;
};

export function formatJobLocator(
  executor: string,
  seq: number,
  output?: string,
): string {
  const locator = `${JOB_SCHEME}://${executor}-${seq}`;

  return output === undefined ? locator : `${locator}/${output}`;
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
  const parsed = parseNumberedLocator(JOB_SCHEME, text);

  return parsed === undefined
    ? undefined
    : { executor: parsed.name, seq: parsed.seq, output: parsed.member };
}
