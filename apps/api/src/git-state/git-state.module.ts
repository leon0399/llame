import { Module } from '@nestjs/common';

import { MachinesModule } from '../machines/machines.module';
import { GitSnapshotService } from './git-snapshot.service';

/** The git snapshot service over the typed executor git surface. */
@Module({
  imports: [MachinesModule],
  providers: [GitSnapshotService],
  exports: [GitSnapshotService],
})
export class GitStateModule {}
