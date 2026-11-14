import { Injectable, type OnModuleDestroy } from '@nestjs/common';

import { BashJobRegistry } from './bash-job-registry';

/** Non-global provider: Nest destroys it before the global queue module. */
@Injectable()
export class WorkerShutdownService implements OnModuleDestroy {
  constructor(private readonly jobs: BashJobRegistry) {}

  async onModuleDestroy(): Promise<void> {
    await this.jobs.shutdown();
  }
}
