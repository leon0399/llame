import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { RunDispatchService } from './run-dispatch.service';
import { RunWaitService } from './run-wait.service';

@Module({
  imports: [QueueModule],
  providers: [RunDispatchService, RunWaitService],
  exports: [RunDispatchService, RunWaitService],
})
export class RunQueueModule {}
