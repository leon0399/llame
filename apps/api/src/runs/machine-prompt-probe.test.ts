import {
  type MachinePromptConnector,
  probeMachinePromptTarget,
} from './machine-prompt-probe';
import { type JsonValue } from '@workspace/machine-protocol';
import { MACHINE_PREPARATION_BUDGET_MS } from './machine-attempt';

type RecordedRequest = {
  readonly name: string;
  readonly method: string;
  readonly params: unknown;
  readonly signal: AbortSignal | undefined;
};

type RecordingConnector = {
  readonly connector: MachinePromptConnector;
  readonly calls: Array<RecordedRequest>;
};

function connector(
  answer: () => Promise<JsonValue>,
  configured = true,
  enabled = true,
): RecordingConnector {
  const calls: Array<RecordedRequest> = [];
  return {
    calls,
    connector: {
      enabled: () => enabled,
      isConfigured: (name: string) => configured && name === 'devl',
      request: (name, method, params, options) => {
        calls.push({ name, method, params, signal: options?.signal });
        return answer();
      },
    },
  };
}

const identity = {
  runId: 'run-1',
  deliverySequence: 4,
  signal: undefined,
};

describe('probeMachinePromptTarget', () => {
  it('resolves an existing target to its canonical locator using the real path', async () => {
    const { connector: machine, calls } = connector(() =>
      Promise.resolve({
        kind: 'file',
        size: 3,
        realPath: '/srv/real notes#1.md',
        isLink: true,
      }),
    );
    const signal = new AbortController().signal;
    await expect(
      probeMachinePromptTarget(
        machine,
        { ...identity, signal },
        { name: 'devl', path: '/srv/notes.md' },
      ),
    ).resolves.toBe('machine://devl/srv/real notes%231.md');
    expect(calls).toEqual([
      {
        name: 'devl',
        method: 'fs.stat',
        params: {
          envelope: {
            runId: 'run-1',
            deliverySeq: 4,
            budgetMs: MACHINE_PREPARATION_BUDGET_MS,
          },
          path: '/srv/notes.md',
        },
        signal,
      },
    ]);
  });

  it('falls back to the submitted path when the Machine reports no real path', async () => {
    const { connector: machine } = connector(() =>
      Promise.resolve({
        kind: 'directory',
        isLink: false,
      }),
    );
    await expect(
      probeMachinePromptTarget(machine, identity, {
        name: 'devl',
        path: '/srv/docs',
      }),
    ).resolves.toBe('machine://devl/srv/docs');
  });

  it('stays prose for a missing target', async () => {
    const { connector: machine } = connector(() =>
      Promise.resolve({
        kind: 'missing',
        isLink: false,
      }),
    );
    await expect(
      probeMachinePromptTarget(machine, identity, {
        name: 'devl',
        path: '/srv/absent.md',
      }),
    ).resolves.toBeUndefined();
  });

  it('stays prose for an answer that is not an fs.stat result', async () => {
    const { connector: machine } = connector(() =>
      Promise.resolve({ kind: 42 }),
    );
    await expect(
      probeMachinePromptTarget(machine, identity, {
        name: 'devl',
        path: '/srv/notes.md',
      }),
    ).resolves.toBeUndefined();
  });

  it('stays prose when the Machine cannot answer', async () => {
    const { connector: machine } = connector(() =>
      Promise.reject(new Error('unreachable')),
    );
    await expect(
      probeMachinePromptTarget(machine, identity, {
        name: 'devl',
        path: '/srv/notes.md',
      }),
    ).resolves.toBeUndefined();
  });

  it('asks nothing without a connector, with Machines disabled, or for an unconfigured name', async () => {
    const target = { name: 'devl', path: '/srv/notes.md' };
    await expect(
      probeMachinePromptTarget(undefined, identity, target),
    ).resolves.toBeUndefined();

    const disabled = connector(
      () => Promise.resolve({ kind: 'file', isLink: false }),
      true,
      false,
    );
    await expect(
      probeMachinePromptTarget(disabled.connector, identity, target),
    ).resolves.toBeUndefined();
    expect(disabled.calls).toEqual([]);

    const unconfigured = connector(() =>
      Promise.resolve({
        kind: 'file',
        isLink: false,
      }),
    );
    await expect(
      probeMachinePromptTarget(unconfigured.connector, identity, {
        name: 'gpu',
        path: '/srv/notes.md',
      }),
    ).resolves.toBeUndefined();
    expect(unconfigured.calls).toEqual([]);
  });
});
