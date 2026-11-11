import { randomUUID } from 'node:crypto';

import { type TenantRunner } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { BashJobRegistry } from '../jobs/bash-job-registry';
import { type ToolContext } from '../tools/types';

/**
 * The worker job runtime a host `bash` call needs: a registry over the test's
 * tenant runner and the Run settings a job records. A test that runs a
 * foreground host command spreads this into its tool context.
 */
export function hostBashJobs(
  tenantDb: TenantRunner,
): Pick<ToolContext, 'bashJobs' | 'jobSettings'> {
  return {
    bashJobs: new BashJobRegistry(
      tenantDb,
      { instanceId: randomUUID() },
      { config: BUILT_IN_DEFAULTS },
    ),
    jobSettings: { modelId: 'test-model', permissionMode: 'default' },
  };
}
