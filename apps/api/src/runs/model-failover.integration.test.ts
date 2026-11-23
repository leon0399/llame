import { ProviderFailure } from '../models/provider-failure/provider-failure';
import type { SystemModelCatalogEntry } from '../models/model-catalog';
import { useSegmentsFixture as setupSegmentsFixture } from '../testing/run-segments.test-fixture';
import { dispatchRun, seedRun } from './worker-harness';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'model-failover.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

const PRIMARY = 'system:openai:failover-primary';
const NEXT = 'system:openai:failover-next';
const PAID = 'system:openai:failover-paid';
const SELECTOR = '@failover-test';

const candidate = (id: string): SystemModelCatalogEntry => ({
  id,
  source: 'system',
  contextWindowTokens: 128_000,
  input: ['text'],
  provider: 'openai',
  providerModelId: id,
  systemPromptTemplate: 'Failover test prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
  billing: 'subscription',
});

const roles = [
  {
    name: 'failover-test',
    candidates: [{ modelId: PRIMARY }, { modelId: PAID }, { modelId: NEXT }],
  },
];

const models: Array<SystemModelCatalogEntry> = [
  candidate(PRIMARY),
  { ...candidate(PAID), billing: 'usage' },
  candidate(NEXT),
];

const policyFixture = setupSegmentsFixture('model-failover-policy', {
  allowedTools: ['bash'],
  failover: {
    agent: {
      availability: 'on',
      access: 'on',
      quota: { switchAfterSeconds: 3600 },
    },
  },
  modelRoles: roles,
  models,
});

const quotaOnFixture = setupSegmentsFixture('model-failover-quota-on', {
  allowedTools: [],
  failover: { agent: { quota: 'on' } },
  modelRoles: roles,
  models,
});

const defaultFixture = setupSegmentsFixture('model-failover-default', {
  allowedTools: [],
  modelRoles: roles,
  models,
});

type LaunchFailureInput = {
  origin: 'owner' | 'agent';
  failure: ProviderFailure;
  nextFailure?: ProviderFailure;
  awaitQuota?: boolean;
  kind?: 'turn' | 'compaction';
};

function registerFailureModels(
  fx: typeof policyFixture,
  input: LaunchFailureInput,
): void {
  fx.harness.models.register(PRIMARY, {
    kind: 'step-script',
    steps: [[{ type: 'error', error: input.failure }]],
  });
  fx.harness.models.register(
    NEXT,
    input.nextFailure === undefined
      ? { kind: 'complete', text: 'next candidate' }
      : {
          kind: 'step-script',
          steps: [[{ type: 'error', error: input.nextFailure }]],
        },
  );
}

async function awaitQuotaRun(fx: typeof policyFixture, runId: string) {
  return vi.waitFor(async () => {
    const current = await fx.run(runId);

    expect(current?.status).toBe('awaiting_quota');

    return current;
  });
}

async function launchFailure(
  fx: typeof policyFixture,
  input: LaunchFailureInput,
) {
  const callsBefore = fx.harness.models.streamCalls.length;

  const seeded = await seedRun({
    tenantDb: fx.harness.tenantDb,
    userId: fx.userId,
    modelId: PRIMARY,
    selector: SELECTOR,
    origin: input.origin,
    kind: input.kind,
  });

  registerFailureModels(fx, input);
  await dispatchRun({
    modelId: PRIMARY,
    queue: fx.harness.queue,
    ...seeded,
    userId: fx.userId,
  });

  const run = input.awaitQuota
    ? await awaitQuotaRun(fx, seeded.runId)
    : await fx.terminal(seeded.runId);

  return {
    run,
    calls: fx.harness.models.streamCalls.slice(callsBefore),
  };
}

describe('production model failover policy', () => {
  it('does not switch after a context overflow', async () => {
    const { run, calls } = await launchFailure(policyFixture, {
      origin: 'agent',
      failure: new ProviderFailure('context overflow', {
        code: 'context_overflow',
      }),
    });

    expect(run?.status).toBe('failed');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(false);
  });

  it('fails over an agent Run through the production decision provider', async () => {
    const { run, calls } = await launchFailure(policyFixture, {
      origin: 'agent',
      failure: new ProviderFailure('account denied', { code: 'auth' }),
    });

    expect(run?.status).toBe('completed');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(true);
  });

  it('does not switch an owner Run when its role cell is off', async () => {
    const { run, calls } = await launchFailure(policyFixture, {
      origin: 'owner',
      failure: new ProviderFailure('account denied', { code: 'auth' }),
    });

    expect(run?.status).toBe('failed');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(false);
  });

  it('never switches under the default policy', async () => {
    const { run, calls } = await launchFailure(defaultFixture, {
      origin: 'agent',
      failure: new ProviderFailure('account denied', { code: 'auth' }),
    });

    expect(run?.status).toBe('failed');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(false);
  });

  it('does not fail over a compaction Run', async () => {
    const { run, calls } = await launchFailure(policyFixture, {
      origin: 'agent',
      kind: 'compaction',
      failure: new ProviderFailure('account denied', { code: 'auth' }),
    });

    expect(run?.status).toBe('failed');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(false);
  });

  it('waits when the quota reset is within the threshold', async () => {
    const { run, calls } = await launchFailure(policyFixture, {
      origin: 'agent',
      awaitQuota: true,
      failure: new ProviderFailure('quota exhausted', {
        code: 'quota_exhausted',
        resetsAt: Date.now() + 1_800_000,
      }),
    });

    expect(run?.status).toBe('awaiting_quota');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(false);
  });

  it('switches when the quota reset exceeds the threshold', async () => {
    const { run, calls } = await launchFailure(policyFixture, {
      origin: 'agent',
      failure: new ProviderFailure('quota exhausted', {
        code: 'quota_exhausted',
        resetsAt: Date.now() + 7_200_000,
      }),
    });

    expect(run?.status).toBe('completed');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(true);
  });

  it('skips a per-token candidate and ends normally when all candidates fail', async () => {
    const { run, calls } = await launchFailure(policyFixture, {
      origin: 'agent',
      failure: new ProviderFailure('account denied', { code: 'auth' }),
      nextFailure: new ProviderFailure('account denied', { code: 'auth' }),
    });

    expect(run?.status).toBe('failed');
    expect(calls.some(({ modelId }) => modelId === PAID)).toBe(false);
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(true);
  });

  it('keeps settled tool output and switches after a broken send', async () => {
    const callsBefore = policyFixture.harness.models.streamCalls.length;

    const seeded = await seedRun({
      tenantDb: policyFixture.harness.tenantDb,
      userId: policyFixture.userId,
      modelId: PRIMARY,
      selector: SELECTOR,
      origin: 'agent',
    });

    policyFixture.harness.models.register(PRIMARY, {
      kind: 'step-script',
      steps: [
        [
          {
            type: 'tool-call',
            toolCallId: 'settled-call',
            toolName: 'bash',
            input: { command: 'printf settled-tool-output' },
          },
        ],
        [
          {
            type: 'tool-call',
            toolCallId: 'broken-call',
            toolName: 'bash',
            input: { command: 'printf broken-tool-output' },
          },
          { type: 'text', id: 'broken-text', text: 'discard this send' },
          {
            type: 'error',
            error: new ProviderFailure('stream broken after tool call', {
              code: 'stream_broken',
              toolCallStarted: true,
              sends: 11,
            }),
          },
        ],
      ],
    });
    policyFixture.harness.models.register(NEXT, {
      kind: 'complete',
      text: 'recovered',
    });

    await dispatchRun({
      modelId: PRIMARY,
      queue: policyFixture.harness.queue,
      ...seeded,
      userId: policyFixture.userId,
    });

    const run = await policyFixture.terminal(seeded.runId);

    const transcript = JSON.stringify(
      await policyFixture.messages(seeded.chatId),
    );

    const events = await policyFixture.events(seeded.runId);
    const calls = policyFixture.harness.models.streamCalls.slice(callsBefore);

    expect(run?.status).toBe('completed');
    expect(transcript).toContain('settled-tool-output');
    expect(transcript).not.toContain('discard this send');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(true);
    expect(events.some((event) => event.eventType === 'model.switched')).toBe(
      true,
    );
  });

  it('switches instead of waiting when the quota cell is on', async () => {
    const { run, calls } = await launchFailure(quotaOnFixture, {
      origin: 'agent',
      failure: new ProviderFailure('quota exhausted', {
        code: 'quota_exhausted',
        resetsAt: Date.now() + 1_800_000,
      }),
    });

    expect(run?.status).toBe('completed');
    expect(calls.some(({ modelId }) => modelId === NEXT)).toBe(true);
  });
});
