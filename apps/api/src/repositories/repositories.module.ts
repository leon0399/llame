import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MachinesModule } from '../machines/machines.module';
import { CheckoutRegistrationService } from './checkout-registration.service';
import { CheckoutsController } from './checkouts.controller';
import { CheckoutsService } from './checkouts.service';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { WorktreeRemovalService } from './worktree-removal.service';

/**
 * The repository catalog, its aliases, and the checkouts where a repository
 * exists on an executor. The compiled `enter_workspace` policy and the instance
 * configuration are global providers, so the module declares only what it owns
 * — plus `MachinesModule`, which supplies the typed git surface every checkout
 * route runs through: the local executor in process, or a Machine over the
 * protocol.
 */
@Module({
  imports: [AuthModule, MachinesModule],
  controllers: [RepositoriesController, CheckoutsController],
  providers: [
    RepositoriesService,
    CheckoutsService,
    CheckoutRegistrationService,
    WorktreeRemovalService,
  ],
})
export class RepositoriesModule {}
