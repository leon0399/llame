import { createJobNoticeItem } from '../chats/job-context-item';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { existingArtifactHostDirectory } from '../tools/artifacts/host-files';
import { type AuthoredContextItemPart } from '../chats/context-item';

/**
 * Read the delivered, settled notices on this trigger and author their job
 * context for dispatch. Notice rows are the authority: output is read only for
 * their owner-scoped, settled job, and an artifact replaces (never duplicates)
 * its chunk output.
 */
export async function createJobNoticeContext(input: {
  readonly tx: Db;
  readonly chatId: string;
  readonly ownerUserId: string;
  readonly messageId: string;
  readonly runId: string;
}): Promise<Array<AuthoredContextItemPart>> {
  const notices = await new ChatDeliveriesRepository(
    input.tx,
  ).listDeliveredJobNotices(input.chatId, input.ownerUserId, input.messageId);

  const jobs = new ChatJobsRepository(input.tx);
  const artifacts = new ArtifactsRepository(input.tx);
  const items: Array<AuthoredContextItemPart> = [];

  for (const notice of notices) {
    const item = await createDeliveredJobNoticeItem({
      chatId: input.chatId,
      ownerUserId: input.ownerUserId,
      runId: input.runId,
      senderRef: notice.senderRef,
      jobs,
      artifacts,
    });

    if (item !== undefined) items.push(item);
  }

  return items;
}

async function createDeliveredJobNoticeItem(input: {
  readonly chatId: string;
  readonly ownerUserId: string;
  readonly runId: string;
  readonly senderRef: string | null;
  readonly jobs: ChatJobsRepository;
  readonly artifacts: ArtifactsRepository;
}): Promise<AuthoredContextItemPart | undefined> {
  if (input.senderRef === null) return undefined;

  const job = await input.jobs.findById(
    input.chatId,
    input.ownerUserId,
    input.senderRef,
  );

  if (!job || job.state === 'running') return undefined;

  const outputs = await readJobNoticeOutputs({
    chatId: input.chatId,
    ownerUserId: input.ownerUserId,
    job,
    jobs: input.jobs,
    artifacts: input.artifacts,
  });

  const hostDirectory = await readJobNoticeHostDirectory(input.chatId, job);

  return createJobNoticeItem({
    runId: input.runId,
    job,
    outputs,
    ...(hostDirectory !== undefined && { hostDirectory }),
  });
}

async function readJobNoticeHostDirectory(
  chatId: string,
  job: ChatJob,
): Promise<string | undefined> {
  if (job.artifactId === null || !job.artifactReadable) return undefined;

  return existingArtifactHostDirectory({
    chatId,
    toolName: job.executor,
    seq: job.seq,
  });
}

async function readJobNoticeOutputs(input: {
  readonly chatId: string;
  readonly ownerUserId: string;
  readonly job: ChatJob;
  readonly jobs: ChatJobsRepository;
  readonly artifacts: ArtifactsRepository;
}): Promise<Array<{ name: string; text: string }>> {
  const outputs: Array<{ name: string; text: string }> = [];

  for (const name of input.job.outputs) {
    const part =
      input.job.artifactId !== null && input.job.artifactReadable
        ? await input.artifacts.readPartTail(
            input.chatId,
            {
              toolName: input.job.executor,
              seq: input.job.seq,
              part: name,
            },
            8000,
          )
        : undefined;

    const bytes =
      part ??
      (await input.jobs.readOutputTail(
        input.ownerUserId,
        input.job.id,
        name,
        8000,
      ));

    outputs.push({ name, text: bytes.toString('utf8') });
  }

  return outputs;
}
