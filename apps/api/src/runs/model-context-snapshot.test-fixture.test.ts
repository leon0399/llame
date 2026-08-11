import { type Db } from '../db/tenant-db.service';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import {
  TOOL_AVAILABILITY_UNOBSERVED,
  TOOL_AVAILABILITY_UNOBSERVED_HASH,
} from '../tools/turn-tool-catalog';
import { resolveEffectiveContext } from './effective-context-resolver';
import { seedModelContextSnapshot } from './model-context-snapshot.test-fixture';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';

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
      allowedToolIds: new Set(),
      candidates: [],
    });
    const createOrReuse = vi
      .spyOn(ModelContextSnapshotsRepository.prototype, 'createOrReuse')
      .mockResolvedValue({
        id: 'snapshot-id',
        ownerUserId,
        ...expectedContext,
        availabilityHash: TOOL_AVAILABILITY_UNOBSERVED_HASH,
        toolAvailabilityManifest: TOOL_AVAILABILITY_UNOBSERVED,
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

    await seedModelContextSnapshot({} as Db, ownerUserId, key);

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
        availabilityHash: TOOL_AVAILABILITY_UNOBSERVED_HASH,
        contentHash: 'content-hash',
        promptHash: 'prompt-hash',
        toolHash: 'tool-hash',
        source: 'project_default',
        systemPrompt: `Test prompt: ${key}`,
        toolAvailabilityManifest: TOOL_AVAILABILITY_UNOBSERVED,
        toolDeclarations: [],
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
      });

    await seedModelContextSnapshot({} as Db, ownerUserId, key, [
      'search_conversations',
    ]);

    const context = createOrReuse.mock.calls[0][1];
    expect(context.toolDeclarations.map(({ id }) => id)).toEqual([
      'search_conversations',
    ]);
  });
});
