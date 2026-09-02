/**
 * Binding ledger check unit tests (chat-search-embeddings, task 5.2). Pure
 * comparison logic + a caller-supplied `EmbeddingBindingLookup` — no
 * Postgres, per the layer's implementation notes.
 */
import type { EmbeddingModelBinding } from '../db/schema/search';
import type { EmbeddingModelCatalogEntry } from '../instance-config/llame-config';
import { InstanceConfigError } from '@workspace/config-interpolation';
import {
  assertBindingConsistent,
  assertDeclaredBindingsConsistent,
  type EmbeddingBindingLookup,
} from './embedding-model-bindings';

function declared(
  overrides: Partial<EmbeddingModelCatalogEntry> = {},
): EmbeddingModelCatalogEntry {
  return {
    id: 'e',
    provider: 'openai',
    providerModelId: 'text-embedding-3-small',
    dimensions: 1536,
    batchSize: 32,
    distanceMetric: 'cosine',
    ...overrides,
  };
}

function binding(
  overrides: Partial<EmbeddingModelBinding> = {},
): EmbeddingModelBinding {
  return {
    modelKey: 'e',
    providerId: 'openai',
    providerModelId: 'text-embedding-3-small',
    revision: null,
    dimensions: 1536,
    distanceMetric: 'cosine',
    documentPrefix: null,
    queryPrefix: null,
    batchSize: 32,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('assertBindingConsistent — first use', () => {
  it('passes when no ledger row exists yet (declared-but-never-embedded key)', () => {
    expect(() => assertBindingConsistent(declared(), undefined)).not.toThrow();
  });
});

describe('assertBindingConsistent — redefinition', () => {
  it('passes when the declared model matches its existing binding exactly', () => {
    expect(() => assertBindingConsistent(declared(), binding())).not.toThrow();
  });

  it('rejects a changed providerModelId, naming the key and field', () => {
    expect(() =>
      assertBindingConsistent(
        declared({ providerModelId: 'text-embedding-3-large' }),
        binding(),
      ),
    ).toThrow(InstanceConfigError);
    expect(() =>
      assertBindingConsistent(
        declared({ providerModelId: 'text-embedding-3-large' }),
        binding(),
      ),
    ).toThrow(/embeddingModels\[e\]\.providerModelId/);
  });

  it('rejects a changed provider (providerId)', () => {
    expect(() =>
      assertBindingConsistent(declared({ provider: 'ollama' }), binding()),
    ).toThrow(/embeddingModels\[e\]\.providerId/);
  });

  it('rejects a changed dimensions', () => {
    expect(() =>
      assertBindingConsistent(declared({ dimensions: 768 }), binding()),
    ).toThrow(/embeddingModels\[e\]\.dimensions/);
  });

  it('rejects a changed revision (undefined declared vs a recorded revision)', () => {
    expect(() =>
      assertBindingConsistent(declared(), binding({ revision: 'v1' })),
    ).toThrow(/embeddingModels\[e\]\.revision/);
  });

  it('rejects a changed documentPrefix/queryPrefix', () => {
    expect(() =>
      assertBindingConsistent(
        declared({ documentPrefix: 'passage: ' }),
        binding(),
      ),
    ).toThrow(/embeddingModels\[e\]\.documentPrefix/);
  });

  it('never names the changed value in the error message', () => {
    try {
      assertBindingConsistent(
        declared({ providerModelId: 'text-embedding-3-large' }),
        binding(),
      );
      expect.unreachable('expected throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('text-embedding-3-large');
      expect(message).not.toContain('text-embedding-3-small');
    }
  });

  // Review checkpoint: batchSize is a throughput knob, NOT part of the
  // embedding space — tuning it must never trigger the mismatch rejection.
  it('does NOT reject a changed batchSize', () => {
    expect(() =>
      assertBindingConsistent(declared({ batchSize: 64 }), binding()),
    ).not.toThrow();
  });
});

describe('assertDeclaredBindingsConsistent', () => {
  it('issues no lookup at all when no models are declared', async () => {
    let calls = 0;
    const ledger: EmbeddingBindingLookup = {
      findBinding: () => {
        calls += 1;
        return Promise.resolve(undefined);
      },
    };
    await assertDeclaredBindingsConsistent([], ledger);
    expect(calls).toBe(0);
  });

  it('looks up each declared model once and rejects on the first mismatch', async () => {
    const ledger: EmbeddingBindingLookup = {
      findBinding: (modelKey) =>
        Promise.resolve(
          modelKey === 'e' ? binding({ dimensions: 999 }) : undefined,
        ),
    };
    await expect(
      assertDeclaredBindingsConsistent([declared({ id: 'e' })], ledger),
    ).rejects.toThrow(/embeddingModels\[e\]\.dimensions/);
  });

  it('accepts a declared-but-unbound model alongside a consistent bound one', async () => {
    const ledger: EmbeddingBindingLookup = {
      findBinding: (modelKey) =>
        Promise.resolve(
          modelKey === 'bound' ? binding({ modelKey }) : undefined,
        ),
    };
    await expect(
      assertDeclaredBindingsConsistent(
        [declared({ id: 'bound' }), declared({ id: 'unbound' })],
        ledger,
      ),
    ).resolves.toBeUndefined();
  });
});
