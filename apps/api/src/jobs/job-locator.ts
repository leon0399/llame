import { type ChatJob } from '../db/schema';
import {
  formatArtifactLocator,
  parseNumberedLocator,
} from '../tools/artifacts/locator';

/**
 * The `job://` locator grammar (background-jobs "A job has a locator scoped to
 * its Chat"). `job://<kind>-<n>` names one job of the current Chat and
 * `job://<kind>-<n>/<output>` names one of its outputs. `<n>` is the artifact
 * number reserved at job start, so the grammar matches `artifact://`.
 */

export const JOB_SCHEME = 'job';

export type JobLocator = {
  readonly kind: string;
  readonly seq: number;
  /** The output name, or undefined for the job record. */
  readonly output: string | undefined;
};

export function formatJobLocator(
  kind: string,
  seq: number,
  output?: string,
): string {
  const locator = `${JOB_SCHEME}://${kind}-${seq}`;

  return output === undefined ? locator : `${locator}/${output}`;
}

/** The artifact locator of a job, when its output is stored as an artifact. */
export function jobArtifactLocatorOf(
  job: Pick<ChatJob, 'kind' | 'seq' | 'artifactId'>,
): string | undefined {
  return job.artifactId === null
    ? undefined
    : formatArtifactLocator(job.kind, job.seq);
}

/** Parse a whole locator; the scheme matches without case. */
export function parseJobLocatorText(text: string): JobLocator | undefined {
  const parsed = parseNumberedLocator(JOB_SCHEME, text);

  return parsed === undefined
    ? undefined
    : { kind: parsed.name, seq: parsed.seq, output: parsed.member };
}
