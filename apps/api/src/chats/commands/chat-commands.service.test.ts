import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import { asDouble } from '../../testing/support';
import type { Chat } from '../../db/schema';
import { TenantDbService, type Db } from '../../db/tenant-db.service';
import { ChatsRepository } from '../chats-repository';
import { TitleService } from '../../titles/title.service';
import { ChatCommandsService } from './chat-commands.service';

function makeService() {
  const db: Db = drizzle.mock();

  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });

  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  );

  const chat = asDouble<Chat>({ id: 'chat-1', archivedAt: null });

  const findById = vi
    .spyOn(ChatsRepository.prototype, 'findById')
    .mockResolvedValue(chat);

  const update = vi
    .spyOn(ChatsRepository.prototype, 'update')
    .mockResolvedValue({ ...chat, title: 'New name' });

  const regenerate = vi.spyOn(TitleService.prototype, 'regenerate');
  const titles: Pick<TitleService, 'regenerate'> = { regenerate };
  const service = new ChatCommandsService(tenantDb, titles);

  return { service, findById, update, regenerate };
}

const request = {
  chatId: 'chat-1',
  userId: 'user-1',
  command: { name: 'rename' as const, argument: ' New name ' },
  parts: [{ type: 'text' as const }],
};

describe('ChatCommandsService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renames an existing Chat without requiring title generation', async () => {
    const { service, update, regenerate } = makeService();
    await expect(service.execute(request)).resolves.toEqual({
      type: 'command',
      command: 'rename',
      title: 'New name',
    });
    expect(update).toHaveBeenCalledWith('chat-1', 'user-1', {
      title: 'New name',
    });
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('falls through for a Chat the owner cannot see', async () => {
    const { service, findById, update } = makeService();
    findById.mockResolvedValue(undefined);
    await expect(service.execute(request)).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a file part for a stored Chat', async () => {
    const { service } = makeService();
    await expect(
      service.execute({ ...request, parts: [{ type: 'file' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an overlong title', async () => {
    const { service, update } = makeService();
    await expect(
      service.execute({
        ...request,
        command: { name: 'rename', argument: 'x'.repeat(201) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('maps bare rename outcomes to their HTTP errors', async () => {
    const { service, regenerate } = makeService();

    const bare = {
      ...request,
      command: { name: 'rename' as const, argument: '' },
    };

    regenerate.mockResolvedValue({ ok: false, reason: 'not_configured' });
    await expect(service.execute(bare)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    regenerate.mockResolvedValue({ ok: false, reason: 'empty' });
    await expect(service.execute(bare)).rejects.toBeInstanceOf(
      ConflictException,
    );
    regenerate.mockResolvedValue({ ok: false, reason: 'failed' });
    await expect(service.execute(bare)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('reports a disappeared Chat after lookup as not found', async () => {
    const { service, update } = makeService();
    update.mockResolvedValue(undefined);
    await expect(service.execute(request)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
