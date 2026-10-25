/* eslint-disable typescript/no-unsafe-assignment -- `expect.any` and `expect.stringContaining` return `any`; each is a matcher inside an assertion, never a read value. */
import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

import { readWorktreeRequest } from '../../tools/workspace-worktree';
import { type CreationWorkspaceResult } from '../chat-creation-workspace';
import {
  type BindFailureCode,
  CreateChatMessageDto,
  CreateChatRequest,
  toWorkspaceResponse,
} from './chat-creation.dto';
import { CreateMessageBodyDto, MessagePartsDto } from './message-parts.dto';

/*
 * `POST /api/v1/chats` request validation (openspec `chat-start-location`,
 * "A chat can be created with its project and location in one request" and "A
 * create request with a message validates it before any write"), plus the
 * response projection of one Workspace outcome ("The response workspace object
 * has one closed status set").
 *
 * The pipe is the production one: `app.setup.ts` installs the same whitelist,
 * forbidNonWhitelisted, and transform options, so a field this schema silently
 * dropped would be a 400 here exactly as it is in the running API.
 */

const CHAT_ID = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';
const MESSAGE_ID = '65f0f6e8-d5ce-4791-a222-e7a0df638810';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const createMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateChatRequest,
};

const routeMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateMessageBodyDto,
};

/** One valid create message; a test removes or replaces the field it probes. */
type MessageBody = {
  id: string;
  modelId: string;
  parts: Array<{ type: string; text: string }>;
  effort?: string;
  permissionMode?: string;
};

function message(overrides: Partial<MessageBody> = {}): MessageBody {
  return {
    id: MESSAGE_ID,
    modelId: 'system:openai:gpt-5.4',
    parts: [{ type: 'text', text: 'Where does this start?' }],
    ...overrides,
  };
}

describe('CreateChatRequest', () => {
  it('accepts a bare chat id — the empty-chat create', async () => {
    await expect(
      pipe.transform({ id: CHAT_ID }, createMetadata),
    ).resolves.toEqual({ id: CHAT_ID });
  });

  it('accepts every documented field together', async () => {
    const body = {
      id: CHAT_ID,
      projectId: '11111111-1111-4111-8111-111111111111',
      repositoryId: '22222222-2222-4222-8222-222222222222',
      executorId: 'host',
      checkoutId: '33333333-3333-4333-8333-333333333333',
      worktree: { name: 'clear-field-0192', baseRef: 'main' },
      message: message({ effort: 'high', permissionMode: 'default' }),
    };

    await expect(pipe.transform(body, createMetadata)).resolves.toEqual(body);
  });

  it('rejects a missing chat id', async () => {
    await expect(pipe.transform({}, createMetadata)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a malformed chat id', async () => {
    await expect(
      pipe.transform({ id: 'not-a-uuid' }, createMetadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects every malformed location id', async () => {
    for (const field of ['projectId', 'repositoryId', 'checkoutId']) {
      await expect(
        pipe.transform({ id: CHAT_ID, [field]: 'nope' }, createMetadata),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('rejects a blank executor id', async () => {
    await expect(
      pipe.transform({ id: CHAT_ID, executorId: '   ' }, createMetadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a location field the schema does not name', async () => {
    await expect(
      pipe.transform({ id: CHAT_ID, machineId: 'nas' }, createMetadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a message without its own id', async () => {
    const { id: _id, ...withoutId } = message();

    await expect(
      pipe.transform({ id: CHAT_ID, message: withoutId }, createMetadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a message without a model', async () => {
    const { modelId: _modelId, ...withoutModel } = message();

    await expect(
      pipe.transform({ id: CHAT_ID, message: withoutModel }, createMetadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a blank model or effort', async () => {
    await expect(
      pipe.transform(
        { id: CHAT_ID, message: message({ modelId: ' ' }) },
        createMetadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { id: CHAT_ID, message: message({ effort: '' }) },
        createMetadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a permission mode outside the closed set', async () => {
    await expect(
      pipe.transform(
        { id: CHAT_ID, message: message({ permissionMode: 'admin' }) },
        createMetadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a message with no parts, a blank part, and a location field', async () => {
    await expect(
      pipe.transform(
        { id: CHAT_ID, message: message({ parts: [] }) },
        createMetadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        {
          id: CHAT_ID,
          message: message({ parts: [{ type: 'text', text: '  ' }] }),
        },
        createMetadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        {
          id: CHAT_ID,
          message: { ...message(), repositoryId: 'not-a-location-field' },
        },
        createMetadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a non-string worktree name but leaves its content to the step', async () => {
    await expect(
      pipe.transform({ id: CHAT_ID, worktree: { name: 7 } }, createMetadata),
    ).rejects.toMatchObject({ status: 400 });
    // A blank name and a `-`-prefixed one are strings here; the create's own
    // step-1 validation answers the 422 the request contract names, so the DTO
    // must not drop them silently.
    await expect(
      pipe.transform({ id: CHAT_ID, worktree: { name: '' } }, createMetadata),
    ).resolves.toMatchObject({ worktree: { name: '' } });
    await expect(
      pipe.transform(
        { id: CHAT_ID, worktree: { name: '-bad' } },
        createMetadata,
      ),
    ).resolves.toMatchObject({ worktree: { name: '-bad' } });
  });

  it('accepts a `-`-prefixed base ref here and refuses it in the step', async () => {
    await expect(
      pipe.transform(
        { id: CHAT_ID, worktree: { baseRef: '--force' } },
        createMetadata,
      ),
    ).resolves.toMatchObject({ worktree: { baseRef: '--force' } });
    expect(readWorktreeRequest({ baseRef: '--force' })).toEqual({
      message: expect.any(String),
    });
  });

  it('rejects a blank base ref', async () => {
    await expect(
      pipe.transform(
        { id: CHAT_ID, worktree: { baseRef: '   ' } },
        createMetadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('the create message schema is its own', () => {
  it('shares only the parts schema with the message route', () => {
    expect(new CreateChatMessageDto()).toBeInstanceOf(MessagePartsDto);
    expect(new CreateMessageBodyDto()).toBeInstanceOf(MessagePartsDto);
    expect(new CreateChatMessageDto()).not.toBeInstanceOf(CreateMessageBodyDto);
    expect(new CreateMessageBodyDto()).not.toBeInstanceOf(CreateChatMessageDto);
  });

  it('rejects the message route schema inside a create request', async () => {
    const { modelId: _modelId, ...bodyOnly } = message();

    await expect(
      pipe.transform({ id: CHAT_ID, message: bodyOnly }, createMetadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a location field on the message route schema', async () => {
    await expect(
      pipe.transform({ ...message(), repositoryId: CHAT_ID }, routeMetadata),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: expect.arrayContaining([
          'property repositoryId should not exist',
        ]),
      },
    });
  });
});

describe('toWorkspaceResponse', () => {
  function project(result: CreationWorkspaceResult) {
    if (result.status === 'conflict') {
      throw new Error('A conflict never reaches the response projection.');
    }
    return toWorkspaceResponse(result);
  }

  it('names the root and executor of a bound checkout', () => {
    expect(
      project({ status: 'bound', root: '/srv/llame', executorId: 'host' }),
    ).toEqual({ status: 'bound', root: '/srv/llame', executorId: 'host' });
  });

  it('names the worktree of a bound worktree', () => {
    const worktree = {
      path: '/srv/.llame-worktrees/llame/one',
      branch: 'llame/one',
      baseCommit: 'a'.repeat(40),
    };

    expect(
      project({
        status: 'bound',
        root: worktree.path,
        executorId: 'host',
        worktree,
      }),
    ).toEqual({
      status: 'bound',
      root: worktree.path,
      executorId: 'host',
      worktree,
    });
  });

  it('names no root when no location resolved', () => {
    expect(project({ status: 'unbound' })).toEqual({ status: 'unbound' });
  });

  it('carries `code` only with the two failure statuses that have codes', () => {
    const codes: ReadonlyArray<BindFailureCode> = [
      'permission_denied',
      'tool_not_allowed',
      'executor_unavailable',
      'not_found',
    ];
    for (const code of codes) {
      expect(
        project({ status: 'bind_failed', code, message: 'refused' }),
      ).toEqual({ status: 'bind_failed', code, message: 'refused' });
    }

    expect(
      project({
        status: 'worktree_failed',
        code: 'path_not_registered',
        message: 'outside the roots',
      }),
    ).toEqual({
      status: 'worktree_failed',
      code: 'path_not_registered',
      message: 'outside the roots',
    });
    // A git failure names no code but still carries its standard error.
    expect(
      project({ status: 'worktree_failed', message: 'fatal: exists' }),
    ).toStrictEqual({ status: 'worktree_failed', message: 'fatal: exists' });
  });

  it('omits a code and a left directory carried as undefined', () => {
    // A caller that spreads an absent field still must not serialize the key:
    // the response contract lists only what the outcome actually carried.
    expect(
      toWorkspaceResponse({
        status: 'worktree_failed',
        code: undefined,
        message: 'fatal: exists',
      }),
    ).toStrictEqual({ status: 'worktree_failed', message: 'fatal: exists' });
    expect(
      toWorkspaceResponse({
        status: 'outcome_unknown',
        message: 'lost',
        leftDirectory: undefined,
      }),
    ).toStrictEqual({ status: 'outcome_unknown', message: 'lost' });
  });

  it('omits an executor and a worktree the binding did not name', () => {
    expect(
      toWorkspaceResponse({ status: 'bound', root: '/srv/llame' }),
    ).toStrictEqual({ status: 'bound', root: '/srv/llame' });
  });

  it('carries `message` and, when known, `leftDirectory` on every other failure', () => {
    for (const status of [
      'machine_unavailable',
      'machine_update_required',
      'outcome_unknown',
    ] as const) {
      const response = project({
        status,
        message: 'the Machine went away',
        ...(status === 'outcome_unknown' && {
          leftDirectory: '/srv/.llame-worktrees/llame/two',
        }),
      });

      // Strict: a projection that always spread its optional fields would
      // add `code: undefined` here, which a loose match cannot see.
      expect(response).toStrictEqual({
        status,
        message: 'the Machine went away',
        ...(status === 'outcome_unknown' && {
          leftDirectory: '/srv/.llame-worktrees/llame/two',
        }),
      });
      expect(response).not.toHaveProperty('root');
    }

    expect(
      project({
        status: 'outcome_unknown',
        message: 'lost',
        leftDirectory: '/srv/.llame-worktrees/llame/two',
      }),
    ).toEqual({
      status: 'outcome_unknown',
      message: 'lost',
      leftDirectory: '/srv/.llame-worktrees/llame/two',
    });
  });
});
