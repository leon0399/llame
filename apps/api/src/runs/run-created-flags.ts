import { isRecord, isString } from '@workspace/runtime-safety';

import { type Db } from '../db/tenant-db.service';
import { RunEventsRepository } from './runs-repository';

/**
 * The facts admission records in `run.created` and later writers read back:
 * whether the reply it replaced had usage, whether it owes a Regenerate notice,
 * and (for a compaction Run) its owner-provided focus.
 */
export async function readCreatedFlags(
  tx: Db,
  runId: string,
  userId: string,
): Promise<{ replacesUsage: boolean; notice: boolean; focus: string | null }> {
  const created = await new RunEventsRepository(tx).findFirstByType(
    runId,
    userId,
    'run.created',
  );

  const payload = created?.payload;
  const record = isRecord(payload) ? payload : {};
  const compaction = isRecord(record['compaction']) ? record['compaction'] : {};
  const focus = compaction['focus'];

  return {
    replacesUsage: record['replacesUsage'] === true,
    notice: record['notice'] === true,
    focus: isString(focus) ? focus : null,
  };
}
