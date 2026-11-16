import type { ChatStreamResponse } from '../chat-stream-response';
import type { CreateMessageDto } from '../dto/chats.dto';
import type { ChatCommandsService } from './chat-commands.service';
import { asDouble } from '../../testing/support';
import { respondToChatCommand } from './respond-to-chat-command';

describe('respondToChatCommand', () => {
  it('forwards a recognized command without inventing optional settings', async () => {
    const execute = vi.fn().mockResolvedValue({ command: 'compacted' });
    const commands = asDouble<ChatCommandsService>({ execute });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const response = asDouble<ChatStreamResponse>({ status });

    const input = asDouble<CreateMessageDto>({
      modelId: 'model-1',
      message: { parts: [{ type: 'text', text: '/compact' }] },
    });

    const handled = await respondToChatCommand(commands, {
      userId: 'owner-1',
      chatId: 'chat-1',
      input,
      response,
    });

    expect(handled).toBe(true);
    expect(execute).toHaveBeenCalledWith({
      chatId: 'chat-1',
      userId: 'owner-1',
      command: { name: 'compact', argument: '' },
      parts: [{ type: 'text', text: '/compact' }],
      modelId: 'model-1',
      messageId: undefined,
      rawText: '/compact',
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ command: 'compacted' });
  });

  it('forwards explicitly selected effort and permission mode', async () => {
    const execute = vi.fn().mockResolvedValue({ command: 'renamed' });
    const commands = asDouble<ChatCommandsService>({ execute });

    const response = asDouble<ChatStreamResponse>({
      status: vi.fn(() => ({ json: vi.fn() })),
    });

    const input = asDouble<CreateMessageDto>({
      modelId: 'model-1',
      effort: 'high',
      permissionMode: 'read-only',
      message: { parts: [{ type: 'text', text: '/rename' }] },
    });

    await respondToChatCommand(commands, {
      userId: 'owner-1',
      chatId: 'chat-1',
      input,
      response,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        effort: 'high',
        permissionMode: 'read-only',
      }),
    );
  });

  it('propagates an unclassified command failure without writing a response', async () => {
    const failure = new Error('command storage failed');
    const execute = vi.fn().mockRejectedValue(failure);
    const commands = asDouble<ChatCommandsService>({ execute });
    const status = vi.fn(() => ({ json: vi.fn() }));
    const response = asDouble<ChatStreamResponse>({ status });

    const input = asDouble<CreateMessageDto>({
      modelId: 'model-1',
      message: { parts: [{ type: 'text', text: '/rename' }] },
    });

    await expect(
      respondToChatCommand(commands, {
        userId: 'owner-1',
        chatId: 'chat-1',
        input,
        response,
      }),
    ).rejects.toBe(failure);
    expect(status).not.toHaveBeenCalled();
  });
});
