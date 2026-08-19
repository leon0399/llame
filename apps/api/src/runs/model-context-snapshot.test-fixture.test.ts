import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { resolveEffectiveContext } from './effective-context-resolver';
import { seedModelContextSnapshot } from './model-context-snapshot.test-fixture';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';

/** `createOrReuse` is spied below, so the tx handle is never dereferenced. */
function fakeTx(): Db {
  return drizzle.mock({ schema });
}

describe('seedModelContextSnapshot', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the production effective-context resolver with no advertised tools', async () => {
    const key = 'fixture-model';
    const ownerUserId = 'owner-id';
    const model: SystemModelCatalogEntry = {
      id: `test:${key}`,
      source: 'system',
      contextWindowTokens: 1,
      provider: 'test',
      providerModelId: 'test',
      systemPromptTemplate: `Test prompt: ${key}`,
      systemPromptSource: 'project_default',
    };
    const expectedContext = await resolveEffectiveContext({
      model,
      systemPrompt: model.systemPromptTemplate,
      allowedToolRules: [],
      callTimeoutSeconds: 15,
      candidates: [],
    });
    const createOrReuse = vi
      .spyOn(ModelContextSnapshotsRepository.prototype, 'createOrReuse')
      .mockResolvedValue({
        id: 'snapshot-id',
        ownerUserId,
        ...expectedContext,
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

    await seedModelContextSnapshot(fakeTx(), ownerUserId, key);

    expect(createOrReuse).toHaveBeenCalledWith(ownerUserId, expectedContext);
    expect(expectedContext.toolDeclarations).toEqual([]);
  });

  it('snapshots explicitly allowlisted production tool declarations', async () => {
    const key = 'tool-fixture';
    const ownerUserId = 'owner-id';
    const createOrReuse = vi
      .spyOn(ModelContextSnapshotsRepository.prototype, 'createOrReuse')
      .mockResolvedValue({
        id: 'snapshot-id',
        ownerUserId,
        availabilityHash: 'availability-hash',
        contentHash: 'content-hash',
        promptHash: 'prompt-hash',
        toolHash: 'tool-hash',
        source: 'project_default',
        systemPrompt: `Test prompt: ${key}`,
        toolAvailabilityManifest: { version: 1, entries: [] },
        toolDeclarations: [],
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

    await seedModelContextSnapshot(fakeTx(), ownerUserId, key, [
      'search_conversations',
    ]);

    const context = createOrReuse.mock.calls[0][1];
    expect(context.toolDeclarations.map(({ id }) => id)).toEqual([
      'search_conversations',
    ]);
  });
});
