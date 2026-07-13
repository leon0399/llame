import { TenantDbService } from '../db/tenant-db.service';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
  ModelsService,
} from '../models/models.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { RunDispatchService } from '../runs/run-dispatch.service';
import { RunStreamBridgeService } from '../runs/run-stream-bridge';
import { ChatLoopService } from './chat-loop.service';
import { type InstanceConfigService } from '../instance-config/instance-config.service';

describe('ChatLoopService model selection', () => {
  function makeService(models?: Partial<ModelsService>) {
    const runAs = jest.fn();
    const validateModelSelection = models?.validateModelSelection ?? jest.fn();
    const dispatchRun = jest.fn();
    const tenantDb = {
      runAs,
    } as unknown as jest.Mocked<TenantDbService>;
    const modelsService = {
      validateModelSelection,
      resolveModelCredential: jest.fn().mockResolvedValue('sk-test'),
      ...models,
    } as unknown as jest.Mocked<ModelsService>;
    const bridge = {
      createUiMessageStreamResponse: jest.fn(),
    } as unknown as jest.Mocked<RunStreamBridgeService>;
    const aborts = {
      abort: jest.fn(),
    } as unknown as jest.Mocked<RunAbortRegistry>;
    const dispatch = {
      dispatch: dispatchRun,
    } as unknown as jest.Mocked<RunDispatchService>;

    const instanceConfig = {
      config: { runs: { timeoutSeconds: 300, heartbeatSeconds: 15 } },
    } as unknown as InstanceConfigService;

    return {
      service: new ChatLoopService(
        tenantDb,
        modelsService,
        instanceConfig,
        bridge,
        aborts,
        dispatch,
      ),
      tenantDb,
      modelsService,
      dispatch,
      runAs,
      validateModelSelection,
      dispatchRun,
    };
  }

  const input = {
    chatId: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
    userId: 'verified-user',
    modelId: 'unknown-model',
    message: {
      id: '0910fd41-1f2f-49de-b1c2-00ff4b3c7c60',
      parts: [{ type: 'text' as const, text: 'Hello' }],
    },
  };

  it('rejects an unavailable model before any message, run, or queue write', async () => {
    const validateModelSelection = jest.fn(() => {
      throw new ModelNotAvailableError('unknown-model');
    });
    const { service, runAs, dispatchRun } = makeService({
      validateModelSelection,
    });

    await expect(service.createMessageStream(input)).rejects.toBeInstanceOf(
      ModelNotAvailableError,
    );
    expect(validateModelSelection).toHaveBeenCalledWith('unknown-model');
    expect(runAs).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });

  it('rejects model configuration errors before any message, run, or queue write', async () => {
    const { service, runAs, dispatchRun } = makeService({
      validateModelSelection: jest.fn(() => {
        throw new ModelConfigurationError('DEFAULT_MODEL_ID is required.');
      }),
    });

    await expect(service.createMessageStream(input)).rejects.toBeInstanceOf(
      ModelConfigurationError,
    );
    expect(runAs).not.toHaveBeenCalled();
    expect(dispatchRun).not.toHaveBeenCalled();
  });
});
