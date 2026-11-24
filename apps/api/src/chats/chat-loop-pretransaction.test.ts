import { BadRequestException } from '@nestjs/common';

import { type TenantRunner } from '../db/tenant-db.service';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { MediaService } from '../media/media.service';
import {
  PermissionModeNotAvailableError,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type RunDispatcher } from '../runs/run-dispatch.service';
import type { RunWaitService } from '../runs/run-wait.service';
import { type RunStreamResponder } from '../runs/run-stream-bridge';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { ChatLoopService } from './chat-loop.service';

const model: SystemModelCatalogEntry = {
  id: 'system:openai:gpt-5.4-mini',
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: 'gpt-5.4-mini',
  systemPromptTemplate: 'Bound prompt',
  systemPromptSource: 'model_override',
  referencesSkills: false,
};

/**
 * The rejection that proves a tenant transaction was opened: every check that
 * lives inside admission never runs here, because this stub never invokes the
 * transaction callback.
 */
const TRANSACTION_OPENED = new Error('tenant transaction opened');

function makeService() {
  const runAs = vi.fn(() => Promise.reject(TRANSACTION_OPENED));

  // The resolver only ever runs inside the transaction callback above, so a
  // call to it here would prove the split moved the wrong way.
  const resolveSelection = vi.fn(() => {
    throw new Error('selection resolved before the transaction');
  });

  const dispatchRun = vi.fn();
  const tenantDb: TenantRunner = { runAs };

  const modelsService: ModelSelectionValidator = {
    validateModelSelection: vi.fn(() => model),
    resolveEffortSelection: vi.fn(() => undefined),
    resolveSelection,
  };

  const instanceConfig: InstanceConfigReader = {
    config: BUILT_IN_DEFAULTS,
  };

  const bridge: RunStreamResponder = {
    createUiMessageStreamResponse: vi.fn(),
  };

  const dispatch: RunDispatcher = {
    dispatch: dispatchRun,
    jobState: () => Promise.resolve('absent'),
  };

  return {
    service: new ChatLoopService(
      tenantDb,
      modelsService,
      instanceConfig,
      bridge,
      dispatch,
      new MediaService(tenantDb),
      {
        wakeForChatInTransaction: vi.fn().mockResolvedValue(false),
      } satisfies Pick<RunWaitService, 'wakeForChatInTransaction'>,
    ),
    runAs,
    resolveSelection,
    dispatchRun,
  };
}

const input = {
  chatId: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  userId: 'verified-user',
  message: {
    id: '0910fd41-1f2f-49de-b1c2-00ff4b3c7c60',
    parts: [{ type: 'text' as const, text: 'Hello' }],
  },
};

describe('ChatLoopService pre-transaction guards', () => {
  // Design D3: the selector, its model, and the effort resolve inside the
  // admission transaction, against the Chat row it locks. Nothing here may
  // judge them before that transaction opens.
  it('resolves a named selector inside the admission transaction', async () => {
    const { service, runAs, resolveSelection, dispatchRun } = makeService();

    await expect(
      service.createMessageStream({ ...input, selector: '@missing' }),
    ).rejects.toBe(TRANSACTION_OPENED);
    expect(runAs).toHaveBeenCalledTimes(1);
    expect(resolveSelection).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });

  it('resolves the effort inside the admission transaction', async () => {
    const { service, runAs, resolveSelection, dispatchRun } = makeService();

    await expect(
      service.createMessageStream({ ...input, effort: 'ludicrous' }),
    ).rejects.toBe(TRANSACTION_OPENED);
    expect(runAs).toHaveBeenCalledTimes(1);
    expect(resolveSelection).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });

  it.each(['bypass', 'read-only'] as const)(
    'rejects a disabled %s mode before opening a tenant transaction or dispatching',
    async (permissionMode) => {
      const { service, runAs, dispatchRun } = makeService();

      await expect(
        service.createMessageStream({ ...input, permissionMode }),
      ).rejects.toMatchObject({
        constructor: PermissionModeNotAvailableError,
        mode: permissionMode,
        code: 'permission_mode_not_available',
        statusCode: 422,
      });
      expect(runAs).not.toHaveBeenCalled();
      expect(dispatchRun).not.toHaveBeenCalled();
    },
  );

  // The mode needs no Chat state, so its check keeps its place before the
  // transaction; a selector that would also fail is only judged inside it.
  it('reports a disabled mode before resolving a selector that the catalog lacks', async () => {
    const { service, runAs, resolveSelection } = makeService();

    await expect(
      service.createMessageStream({
        ...input,
        selector: '@missing',
        permissionMode: 'bypass',
      }),
    ).rejects.toBeInstanceOf(PermissionModeNotAvailableError);
    expect(runAs).not.toHaveBeenCalled();
    expect(resolveSelection).not.toHaveBeenCalled();
  });

  it('rejects an all-non-text direct-service message before opening a tenant transaction', async () => {
    const { service, runAs } = makeService();

    await expect(
      service.createMessageStream({
        ...input,
        message: {
          ...input.message,
          parts: [
            {
              type: 'data-context',
              data: {
                v: 1,
                producer: 'effective-context-change',
                form: 'notice',
                runId: '11111111-1111-4111-8111-111111111111',
                payload: {
                  cause: 'model',
                  fromModelId: 'forged-a',
                  toModelId: 'forged-b',
                },
              },
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(runAs).not.toHaveBeenCalled();
  });
});
