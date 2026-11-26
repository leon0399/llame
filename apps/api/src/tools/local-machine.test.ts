import { describe, expect, it } from 'vitest';

import { localMachineConnector } from '../testing/local-machine';
import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
} from '../machines/machine-session-errors';
import { verifyLocalMachine } from './local-machine';
import { type ToolContext } from './types';

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    configuredCredentials: [],
    tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    localMachine: 'host-a',
    defaultMachine: 'host-a',
    machines: localMachineConnector(),
    ...overrides,
  };
}

describe('verifyLocalMachine', () => {
  it('lets the operation run once the local daemon verified', async () => {
    await expect(verifyLocalMachine(context())).resolves.toBeUndefined();
  });

  it('refuses a mismatched identity with its own operator outcome', async () => {
    const refusal = await verifyLocalMachine(
      context({
        machines: localMachineConnector({
          verify: () =>
            Promise.reject(new MachineIdentityMismatchError('host-a')),
        }),
      }),
    );

    expect(refusal).toMatchObject({
      status: 'error',
      type: 'machine_identity_mismatch',
    });
    expect(refusal?.message).toContain('machines:forget');
  });

  it('reports an unavailable local Machine with the reason', async () => {
    const refusal = await verifyLocalMachine(
      context({
        machines: localMachineConnector({
          verify: () =>
            Promise.reject(
              new MachineUnavailableError(
                'host-a',
                'session_lost',
                false,
                'The session was lost.',
              ),
            ),
        }),
      }),
    );

    expect(refusal).toMatchObject({
      status: 'error',
      type: 'machine_unavailable',
    });
    expect(refusal?.message).toContain('the session was lost');
  });

  it.each([
    ['no local Machine name', { localMachine: undefined }],
    ['no connector', { machines: undefined }],
  ] as const)(
    'refuses in process when there is %s',
    async (_label, overrides) => {
      const refusal = await verifyLocalMachine(context(overrides));

      expect(refusal).toMatchObject({
        status: 'error',
        type: 'machine_unavailable',
      });
      expect(refusal?.message).toContain('No local Machine is configured');
    },
  );

  it('never turns an unexpected failure into a result', async () => {
    const broken = localMachineConnector({
      verify: () => Promise.reject(new Error('bug')),
    });

    await expect(
      verifyLocalMachine(context({ machines: broken })),
    ).rejects.toThrow('bug');
  });
});
