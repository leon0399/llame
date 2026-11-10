import { isRecord } from '@workspace/runtime-safety';

import { type Db } from '../db/tenant-db.service';
import { RunEventsRepository } from './runs-repository';

/**
 * The two facts admission records in `run.created` and a later writer reads
 * back: whether the reply it replaced had usage (D11), and whether it owes the
 * turn the Regenerate notice (D9).
 */
export async function readCreatedFlags(
  tx: Db,
  runId: string,
  userId: string,
): Promise<{ replacesUsage: boolean; notice: boolean }> {
  const created = await new RunEventsRepository(tx).findFirstByType(
    runId,
    userId,
    'run.created',
  );

  const payload = created?.payload;
  const record = isRecord(payload) ? payload : {};

  return {
    replacesUsage: record['replacesUsage'] === true,
    notice: record['notice'] === true,
  };
}
