import {
  ChatCreationController,
  type ChatCreationControllerService,
} from './chat-creation.controller';
import { toChatResponse } from './dto/chats.dto';
import type { Chat } from '../db/schema';
import { ModelNotAvailableError } from '../models/models.service';

const chat: Chat = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'verified-user',
  title: 'Owned Chat',
  visibility: 'private',
  createdAt: new Date('2026-06-29T00:00:00.000Z'),
  updatedAt: new Date('2026-06-29T00:00:00.000Z'),
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  workspaceRoot: null,
  workspaceExecutorId: null,
  workspaceGeneration: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceToldAvailable: null,
  workspaceDetachReason: null,
};

const chatId = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';

function makeController() {
  const chatCreation = {
    create: vi.fn<ChatCreationControllerService['create']>(),
    getCreationRecord:
      vi.fn<ChatCreationControllerService['getCreationRecord']>(),
  } satisfies ChatCreationControllerService;
  return { controller: new ChatCreationController(chatCreation), chatCreation };
}

describe('ChatCreationController', () => {
  it('forwards a create request under the session identity', async () => {
    const { controller, chatCreation } = makeController();
    chatCreation.create.mockResolvedValue({
      chat: toChatResponse(chat),
      workspace: { status: 'unbound' },
    });
    const body = { id: chatId, projectId: undefined } as const;

    const created = await controller.createChat('verified-user', {
      ...body,
    });

    expect(chatCreation.create).toHaveBeenCalledWith('verified-user', body);
    expect(created.workspace).toEqual({ status: 'unbound' });
  });

  it('maps an unavailable model on a create request to 422', async () => {
    const { controller, chatCreation } = makeController();
    chatCreation.create.mockRejectedValue(
      new ModelNotAvailableError('system:openai:missing'),
    );

    await expect(
      controller.createChat('verified-user', { id: chatId }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rethrows an unknown create failure unchanged', async () => {
    const { controller, chatCreation } = makeController();
    chatCreation.create.mockRejectedValue(new Error('disk full'));

    await expect(
      controller.createChat('verified-user', { id: chatId }),
    ).rejects.toThrow('disk full');
  });

  it('reads the creation record for the verified user only', async () => {
    const { controller, chatCreation } = makeController();
    chatCreation.getCreationRecord.mockResolvedValue({
      chatId,
      attempts: [],
    });

    await expect(
      controller.getChatCreationRecord('verified-user', chatId),
    ).resolves.toEqual({ chatId, attempts: [] });
    expect(chatCreation.getCreationRecord).toHaveBeenCalledWith(
      'verified-user',
      chatId,
    );
  });
});
