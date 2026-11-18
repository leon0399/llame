import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { compactCommandOf } from '../chats/commands/parse-chat-command';
import type { TenantDbService } from '../db/tenant-db.service';

export type CompactionSet = {
  readonly ids: ReadonlyArray<string>;
  readonly focus: string | null;
};

/** Read the pending compact commands before summary work starts. */
export async function readCompactionSet(input: {
  readonly tenantDb: Pick<TenantDbService, 'runAs'>;
  readonly chatId: string;
  readonly userId: string;
}): Promise<CompactionSet> {
  const pending = await input.tenantDb.runAs(input.userId, (tx) =>
    new ChatDeliveriesRepository(tx).listPending(input.chatId, input.userId),
  );

  const commands = pending.flatMap((item) => {
    if (item.mode !== 'steer' && item.mode !== 'interrupt') return [];

    const command = compactCommandOf(item);

    return command?.name === 'compact'
      ? [{ item, focus: command.argument }]
      : [];
  });

  return {
    ids: commands.map(({ item }) => item.id),
    focus: commands[0]?.focus || null,
  };
}
