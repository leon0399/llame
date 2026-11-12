import { type ChatJob } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { notifyLiveRunSteering } from '../chats/chat-admission';

/** Record a winning settlement's notice and steer a live Run in the same transaction. */
export async function recordJobSettlementNotice(
  tx: Db,
  job: ChatJob,
): Promise<void> {
  await new ChatDeliveriesRepository(tx).insertJobNotice(job);

  await notifyLiveRunSteering(
    tx,
    { chatId: job.chatId, userId: job.ownerUserId },
    'steer',
  );
}
