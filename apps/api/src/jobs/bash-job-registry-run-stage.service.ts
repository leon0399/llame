import { Inject, Injectable } from '@nestjs/common';
import { type ManagedOutput } from '../tools/bash-contract';
import { type ChatJob } from '../db/schema';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { JobNoticeRunService } from '../runs/job-notice-run.service';
import { RunWaitService } from '../runs/run-wait.service';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import { type Job } from '@workspace/machine-protocol';
import { settleDaemonJob as settleDaemonJobStage } from './bash-job-registry-settlement';

@Injectable()
export class BashJobRegistryRunStageService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(InstanceConfigService)
    private readonly config: InstanceConfigReader,
    @Inject(JobNoticeRunService)
    private readonly noticeRuns: Pick<JobNoticeRunService, 'startOnSettlement'>,
    @Inject(RunWaitService)
    private readonly runWait: Pick<RunWaitService, 'wakeForChatInTransaction'>,
  ) {}

  settle(
    row: ChatJob,
    job: Job,
    output: ManagedOutput | null,
    backgrounded: boolean,
  ): Promise<void> {
    return settleDaemonJobStage({
      tenantDb: this.tenantDb,
      config: this.config,
      noticeRuns: this.noticeRuns,
      runWait: this.runWait,
      row,
      job,
      output,
      backgrounded,
    });
  }
}
