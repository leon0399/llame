/**
 * cli-commands unit tests (chat-search-embeddings/operations, layer 7) —
 * the pieces of the `search:*` CLI dispatcher that need no database:
 * `requireEmbeddingModelId`'s config gate, `failIfAnyOwnerFailed`'s shared
 * fail-loud reporting, and `runCommand`'s unknown-command rejection (which
 * must throw BEFORE touching any dependency — proven here by asserting the
 * fakes are never called). `runBackfillCommand`/`runPruneCommand`/
 * `runRetryFailedCommand`/`runCoverageCommand`/`runProjectionCoverageCommand`
 * each end up calling `forEachOwner` (`owner-write.ts`) or another function
 * that needs the real Drizzle query builder (`.select().from()`), which no
 * lightweight literal can satisfy without a banned cast — see
 * `owner-write.test.ts`'s header for the same boundary. Those five, and the
 * rest of `runCommand`'s dispatch, are covered against real Postgres in
 * `cli-commands.integration.test.ts`.
 */
import { type InstanceConfigReader } from '../../instance-config/instance-config.service';
import { BUILT_IN_DEFAULTS } from '../../instance-config/llame-config';
import {
  failIfAnyOwnerFailed,
  requireEmbeddingModelId,
  runCommand,
  type CommandDeps,
} from './cli-commands';

function fakeInstanceConfig(embeddingModelId: string | null) {
  const config = {
    ...BUILT_IN_DEFAULTS,
    search: {
      chats: { ...BUILT_IN_DEFAULTS.search.chats, embeddingModelId },
    },
  };
  return { config } satisfies InstanceConfigReader;
}

describe('requireEmbeddingModelId', () => {
  it('throws a config-pointing error when search.chats.embeddingModelId is unset', () => {
    expect(() => requireEmbeddingModelId(fakeInstanceConfig(null))).toThrow(
      /search\.chats\.embeddingModelId is not configured/,
    );
  });

  it('returns the configured model id', () => {
    expect(requireEmbeddingModelId(fakeInstanceConfig('model-a'))).toBe(
      'model-a',
    );
  });
});

describe('failIfAnyOwnerFailed', () => {
  it('is a no-op for an empty failure list', () => {
    expect(() => failIfAnyOwnerFailed('prune', [])).not.toThrow();
  });

  it('throws naming the command and failure count, logging each failure', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        failIfAnyOwnerFailed('prune', [
          { ownerId: 'u1', message: 'conn reset' },
          { ownerId: 'u2', message: 'timeout' },
        ]),
      ).toThrow(/prune: FAILED for 2 owner\(s\)/);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('u1'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('u2'));
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('runCommand — unknown command', () => {
  it('rejects before touching any dependency', async () => {
    const deps: CommandDeps = {
      tenantDb: { runAs: vi.fn(), runAsPublic: vi.fn() },
      instanceConfig: fakeInstanceConfig('model-a'),
      dispatch: { enqueueChatEmbedStrict: vi.fn() },
    };

    await expect(runCommand('bogus', deps)).rejects.toThrow(
      /Unknown command "bogus"/,
    );
    expect(deps.tenantDb.runAs).not.toHaveBeenCalled();
    expect(deps.tenantDb.runAsPublic).not.toHaveBeenCalled();
    expect(deps.dispatch.enqueueChatEmbedStrict).not.toHaveBeenCalled();
  });
});
