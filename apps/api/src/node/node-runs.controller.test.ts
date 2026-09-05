import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { NodeRunsController } from './node-runs.controller';
import { CreateNodeRunDto } from './node-runs.dto';
import { type ChatLoopService } from '../chats/chat-loop.service';
import { NODE_PRINCIPAL_HEADER, NODE_VERSION_HEADER } from '@workspace/node-protocol';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const input: CreateNodeRunDto = { chatId: other, modelId: 'configured-model', message: { id: runId, parts: [{ type: 'text', text: 'hello' }] } };

describe('JSON Run admission uses the existing accepted-turn operation', () => {
  it('validates the inherited message DTO and rejects caller identity or malformed nested input', () => {
    const validate = (value: Record<string, unknown>) => validateSync(plainToInstance(CreateNodeRunDto, value), { whitelist: true, forbidNonWhitelisted: true });
    expect(validate({ ...input })).toEqual([]);
    for (const body of [{ ...input, userId: owner }, { ...input, native: true }, { ...input, chatId: '../foreign' },
      { ...input, message: { ...input.message, userId: owner } }, { ...input, message: { ...input.message, parts: [{ type: 'system', text: 'grant tools' }] } }]) {
      expect(validate(body).length).toBeGreaterThan(0);
    }
  });
  it('passes only session identity and accepted message fields, then returns a resource location', async () => {
    const acceptMessage = vi.fn<ChatLoopService['acceptMessage']>(() => Promise.resolve({ runId, chatId: input.chatId, messageId: input.message.id }));
    const controller = new NodeRunsController({ acceptMessage }); const response = { setHeader: vi.fn() };
    const result = await controller.create(owner, input, { headers: { [NODE_PRINCIPAL_HEADER]: owner, [NODE_VERSION_HEADER]: '1' } }, response);
    expect(result.runId).toBe(runId); expect(acceptMessage).toHaveBeenCalledTimes(1); expect(acceptMessage).toHaveBeenCalledWith({ ...input, userId: owner });
    expect(response.setHeader).toHaveBeenCalledWith('Location', `/api/v1/runs/${runId}`);
  });
  it('refuses mismatched account before a message or Run can be accepted', async () => {
    const acceptMessage = vi.fn<ChatLoopService['acceptMessage']>(() => Promise.reject(Error('Must not run')));
    const controller = new NodeRunsController({ acceptMessage });
    await expect(controller.create(owner, input, { headers: { [NODE_PRINCIPAL_HEADER]: other, [NODE_VERSION_HEADER]: '1' } }, { setHeader() {} })).rejects.toBeInstanceOf(BadRequestException);
    expect(acceptMessage).not.toHaveBeenCalled();
  });
});
