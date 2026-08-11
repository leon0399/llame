import { and, eq } from 'drizzle-orm';

import {
  modelContextSnapshots,
  runs,
  type ModelContextSnapshot,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  canonicalJson,
  type EffectiveContextSnapshotInput,
} from './effective-context-resolver';

export class ModelContextSnapshotConflictError extends Error {
  constructor() {
    super('Model context snapshot hash conflicts with stored content');
    this.name = 'ModelContextSnapshotConflictError';
  }
}

function hasIdenticalContent(
  snapshot: ModelContextSnapshot,
  input: EffectiveContextSnapshotInput,
): boolean {
  return (
    snapshot.contentHash === input.contentHash &&
    snapshot.promptHash === input.promptHash &&
    snapshot.toolHash === input.toolHash &&
    snapshot.source === input.source &&
    snapshot.systemPrompt === input.systemPrompt &&
    canonicalJson(snapshot.toolDeclarations) ===
      canonicalJson(input.toolDeclarations)
  );
}

/** Immutable, owner-scoped access to effective-context receipts. */
export class ModelContextSnapshotsRepository {
  constructor(private readonly db: Db) {}

  async createOrReuse(
    ownerUserId: string,
    input: EffectiveContextSnapshotInput,
  ): Promise<ModelContextSnapshot> {
    const [created] = await this.db
      .insert(modelContextSnapshots)
      .values({ ownerUserId, ...input })
      .onConflictDoNothing({
        target: [
          modelContextSnapshots.ownerUserId,
          modelContextSnapshots.contentHash,
          modelContextSnapshots.source,
        ],
      })
      .returning();

    if (created) {
      return created;
    }

    const [existing] = await this.db
      .select()
      .from(modelContextSnapshots)
      .where(
        and(
          eq(modelContextSnapshots.ownerUserId, ownerUserId),
          eq(modelContextSnapshots.contentHash, input.contentHash),
          eq(modelContextSnapshots.source, input.source),
        ),
      )
      .limit(1);

    if (!existing || !hasIdenticalContent(existing, input)) {
      throw new ModelContextSnapshotConflictError();
    }

    return existing;
  }

  async findByOwnedRun(
    runId: string,
    ownerUserId: string,
  ): Promise<ModelContextSnapshot | undefined> {
    const rows = await this.db
      .select({ snapshot: modelContextSnapshots })
      .from(modelContextSnapshots)
      .innerJoin(
        runs,
        and(
          eq(runs.modelContextSnapshotId, modelContextSnapshots.id),
          eq(runs.userId, modelContextSnapshots.ownerUserId),
        ),
      )
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.userId, ownerUserId),
          eq(modelContextSnapshots.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);

    return rows[0]?.snapshot;
  }
}
