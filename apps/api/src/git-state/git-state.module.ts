import { Module } from '@nestjs/common';

import { MachinesModule } from '../machines/machines.module';
import {
  createGitProducer,
  GIT_CONTEXT_PRODUCER,
} from './git-context-producer';
import { GitSnapshotService } from './git-snapshot.service';

/** The git snapshot service, and the producer that tells its state to a Run. */
@Module({
  imports: [MachinesModule],
  providers: [
    GitSnapshotService,
    { provide: GIT_CONTEXT_PRODUCER, useValue: createGitProducer() },
  ],
  exports: [GitSnapshotService, GIT_CONTEXT_PRODUCER],
})
export class GitStateModule {}
