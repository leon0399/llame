import { Module } from '@nestjs/common';
import { inspectRepository } from '@workspace/git-executor';

import { AuthModule } from '../auth/auth.module';
import {
  CheckoutRegistrationService,
  GIT_INSPECTOR,
} from './checkout-registration.service';
import { CheckoutsController } from './checkouts.controller';
import { CheckoutsService } from './checkouts.service';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';

/**
 * The repository catalog, its aliases, and the checkouts where a repository
 * exists on an executor. The compiled `enter_workspace` policy and the instance
 * configuration are global providers, so the module declares only what it owns
 * — and the git surface behind a token, so a suite can substitute one fake
 * inspector.
 */
@Module({
  imports: [AuthModule],
  controllers: [RepositoriesController, CheckoutsController],
  providers: [
    RepositoriesService,
    CheckoutsService,
    CheckoutRegistrationService,
    {
      provide: GIT_INSPECTOR,
      useValue: { inspect: (path: string) => inspectRepository({ path }) },
    },
  ],
})
export class RepositoriesModule {}
