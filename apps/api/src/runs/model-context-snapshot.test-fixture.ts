import { type ModelContextSnapshot } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type SystemModelCatalogEntry } from '../models/model-catalog';
import { resolveEffectiveContext } from './effective-context-resolver';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';

/** Minimal immutable snapshot for tests that seed runs below the chat loop. */
export async function seedModelContextSnapshot(
  db: Db,
  ownerUserId: string,
  key = 'default',
  allowedToolIds: readonly string[] = [],
): Promise<ModelContextSnapshot> {
  const systemPrompt = `Test prompt: ${key}`;
  const model: SystemModelCatalogEntry = {
    id: `test:${key}`,
    source: 'system',
    contextWindowTokens: 1,
    provider: 'test',
    providerModelId: 'test',
    systemPrompt,
    systemPromptSource: 'project_default',
  };
  const context = await resolveEffectiveContext({
    model,
    allowedToolIds: new Set(allowedToolIds),
  });

  return new ModelContextSnapshotsRepository(db).createOrReuse(
    ownerUserId,
    context,
  );
}
