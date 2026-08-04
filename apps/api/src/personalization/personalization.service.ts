import { Injectable } from '@nestjs/common';

import { type Personalization } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { type PromptUserInput } from '../models/model-catalog';
import { resolvePromptUserInput } from './personalization-context';
import {
  PersonalizationRepository,
  type PersonalizationUpdate,
} from './personalization-repository';

/**
 * The only capability the send path needs. Narrower than the whole service on
 * purpose: `PersonalizationService` has a private field, so a structural stub
 * can never satisfy it and every test would need a cast to fake it. Depending
 * on the method instead keeps the dependency honest and keeps test doubles
 * plain objects.
 */
export type PromptUserResolver = Pick<
  PersonalizationService,
  'resolvePromptUser'
>;

@Injectable()
export class PersonalizationService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /** The owner's stored profile, or undefined when they have never written one. */
  async getForOwner(userId: string): Promise<Personalization | undefined> {
    return this.tenantDb.runAs(userId, (tx) =>
      new PersonalizationRepository(tx).findForOwner(userId),
    );
  }

  async updateForOwner(
    userId: string,
    update: PersonalizationUpdate,
  ): Promise<Personalization> {
    return this.tenantDb.runAs(userId, (tx) =>
      new PersonalizationRepository(tx).upsertForOwner(userId, update),
    );
  }

  /**
   * Per-user values for one run's prompt, already gated by the owner's toggles.
   *
   * Deliberately its own short transaction, taken BEFORE the send path opens
   * the transaction that binds the run: that one holds the chat row for its
   * whole duration, and widening it to cover this read would extend the hold
   * for no reason. The cost of the split is that a personalization edit
   * committed between this read and the bind applies only to the next run —
   * accepted and specified.
   */
  async resolvePromptUser(
    userId: string,
  ): Promise<PromptUserInput | undefined> {
    const { personalization, account } = await this.tenantDb.runAs(
      userId,
      async (tx) => {
        const repository = new PersonalizationRepository(tx);
        return {
          personalization: await repository.findForOwner(userId),
          account: await repository.findAccountIdentity(userId),
        };
      },
    );

    return resolvePromptUserInput({ personalization, account });
  }
}
