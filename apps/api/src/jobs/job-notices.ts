import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { notifyRunControl } from '../runs/run-control';
import { RunsRepository } from '../runs/runs-repository';

/** Record a winning settlement's notice and signal a live non-suspended Run. */
export async function recordJobSettlementNotice(
  tx: Db,
  job: ChatJob,
): Promise<void> {
  await new ChatDeliveriesRepository(tx).insertJobNotice(job);

  const run = await new RunsRepository(tx).findActiveByChatId(
    job.chatId,
    job.ownerUserId,
  );

  if (run && run.status !== 'awaiting_jobs') {
    await notifyRunControl(tx, { runId: run.id, kind: 'steer' });
  }
}
