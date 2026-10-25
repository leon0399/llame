import { HttpException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Checkout } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type CheckoutRegistrationService } from './checkout-registration.service';
import { CheckoutsService } from './checkouts.service';
import { RepositoriesRepository } from './repositories.repository';

const checkout: Checkout = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'owner-a',
  repositoryId: '1b6f5499-dde4-43cf-89fe-037998a0fe64',
  executorId: 'local-exec',
  path: '/home/me/llame',
  kind: 'main',
  parentCheckoutId: null,
  branch: 'main',
  origin: 'registered',
  worktreeBase: null,
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
};

const worktree: Checkout = {
  ...checkout,
  id: '2b6f5499-dde4-43cf-89fe-037998a0fe64',
  path: '/home/me/llame-feature',
  kind: 'worktree',
  parentCheckoutId: checkout.id,
  branch: 'feature',
};

const other: Checkout = {
  ...checkout,
  id: '3b6f5499-dde4-43cf-89fe-037998a0fe64',
  path: '/home/me/other',
};

// The service is the app layer over the repository: every data call is spied on
// the prototype, so the assertions are the arguments and the merged summary,
// and the RLS-scoped SQL itself stays in `checkouts.integration.test.ts`.
function makeService() {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  );
  const register = vi
    .fn<CheckoutRegistrationService['register']>()
    .mockResolvedValue(checkout);
  const service = new CheckoutsService(tenantDb, registrationDouble(register));
  vi.spyOn(RepositoriesRepository.prototype, 'chatsBoundTo').mockResolvedValue(
    new Map(),
  );
  vi.spyOn(RepositoriesRepository.prototype, 'leaseChats').mockResolvedValue(
    new Map(),
  );
  // A delete starts from a checkout with no worktree children; a case that
  // states the count is the one that reaches the guard.
  vi.spyOn(
    RepositoriesRepository.prototype,
    'countWorktrees',
  ).mockResolvedValue(0);
  return { service, register };
}

/**
 * The registration double: `register` is the only member this suite drives,
 * and the service reaches nothing else on it. The class carries injected
 * private state, so a structural object cannot name its type.
 */
function registrationDouble(
  register: CheckoutRegistrationService['register'],
): CheckoutRegistrationService {
  // SAFETY: the service calls exactly this member, and the double answers with
  // the row under test; every other member would be a call this suite misses.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return { register } as never;
}

/** The typed body an HttpException answers with. */
async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error.getResponse();
    throw error;
  }
  throw new Error('expected the call to fail');
}

/** The one body an invalid worktree base answers with. */
function invalidWorktreeBase(message: string) {
  return {
    statusCode: 422,
    error: 'Unprocessable Entity',
    message,
    code: 'invalid_worktree_base',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CheckoutsService', () => {
  describe('register', () => {
    it('summarizes the new row with the chats already bound to its path', async () => {
      const { service, register } = makeService();
      const chatsBoundTo = vi
        .spyOn(RepositoriesRepository.prototype, 'chatsBoundTo')
        .mockResolvedValue(new Map([[checkout.path, ['chat-a', 'chat-b']]]));
      const leaseChats = vi.spyOn(
        RepositoriesRepository.prototype,
        'leaseChats',
      );

      await expect(
        service.register('owner-a', { path: checkout.path }),
      ).resolves.toEqual({
        ...checkout,
        chatIds: ['chat-a', 'chat-b'],
        leaseChatId: null,
      });

      expect(register).toHaveBeenCalledWith('owner-a', { path: checkout.path });
      expect(chatsBoundTo).toHaveBeenCalledWith('owner-a', [checkout.path]);
      // A `main` row leases nothing, so the lease query asks for no id at all.
      expect(leaseChats).toHaveBeenCalledWith('owner-a', []);
    });
  });

  describe('listCheckouts', () => {
    it('attaches bound chats and the lease chat of each worktree row', async () => {
      const { service } = makeService();
      const listCheckouts = vi
        .spyOn(RepositoriesRepository.prototype, 'listCheckouts')
        .mockResolvedValue([checkout, worktree, other]);
      const chatsBoundTo = vi
        .spyOn(RepositoriesRepository.prototype, 'chatsBoundTo')
        .mockResolvedValue(new Map([[checkout.path, ['chat-a', 'chat-b']]]));
      const leaseChats = vi
        .spyOn(RepositoriesRepository.prototype, 'leaseChats')
        .mockResolvedValue(new Map([[worktree.id, 'chat-c']]));

      await expect(service.listCheckouts('owner-a')).resolves.toEqual([
        { ...checkout, chatIds: ['chat-a', 'chat-b'], leaseChatId: null },
        { ...worktree, chatIds: [], leaseChatId: 'chat-c' },
        { ...other, chatIds: [], leaseChatId: null },
      ]);

      expect(listCheckouts).toHaveBeenCalledWith('owner-a', undefined);
      expect(chatsBoundTo).toHaveBeenCalledWith('owner-a', [
        checkout.path,
        worktree.path,
        other.path,
      ]);
      // Only a worktree can be leased: a main row never contributes its id.
      expect(leaseChats).toHaveBeenCalledWith('owner-a', [worktree.id]);
    });

    it('passes the repository filter to the query', async () => {
      const { service } = makeService();
      const listCheckouts = vi
        .spyOn(RepositoriesRepository.prototype, 'listCheckouts')
        .mockResolvedValue([]);

      await expect(
        service.listCheckouts('owner-a', checkout.repositoryId),
      ).resolves.toEqual([]);

      expect(listCheckouts).toHaveBeenCalledWith(
        'owner-a',
        checkout.repositoryId,
      );
    });
  });

  describe('setWorktreeBase', () => {
    it('answers 404 when the row is not this owner’s', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(undefined);

      await expect(
        failureOf(
          service.setWorktreeBase('owner-a', checkout.id, '/srv/worktrees'),
        ),
      ).resolves.toMatchObject({ statusCode: 404, code: 'not_found' });
    });

    it('refuses a worktree row without touching the row', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(worktree);
      const setWorktreeBase = vi.spyOn(
        RepositoriesRepository.prototype,
        'setWorktreeBase',
      );

      await expect(
        failureOf(
          service.setWorktreeBase('owner-a', worktree.id, '/srv/worktrees'),
        ),
      ).resolves.toEqual(
        invalidWorktreeBase(
          'A worktree checkout cannot carry a worktree base; placement hangs off its main clone.',
        ),
      );

      expect(setWorktreeBase).not.toHaveBeenCalled();
    });

    it('accepts an absolute host path on a local checkout', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(checkout);
      const setWorktreeBase = vi
        .spyOn(RepositoriesRepository.prototype, 'setWorktreeBase')
        .mockResolvedValue({ ...checkout, worktreeBase: '/srv/worktrees' });
      vi.spyOn(
        RepositoriesRepository.prototype,
        'chatsBoundTo',
      ).mockResolvedValue(new Map([[checkout.path, ['chat-a']]]));

      await expect(
        service.setWorktreeBase('owner-a', checkout.id, '/srv/worktrees'),
      ).resolves.toEqual({
        ...checkout,
        worktreeBase: '/srv/worktrees',
        chatIds: ['chat-a'],
        leaseChatId: null,
      });

      expect(setWorktreeBase).toHaveBeenCalledWith(
        'owner-a',
        checkout.id,
        '/srv/worktrees',
      );
    });

    it('refuses a relative path on a local checkout', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(checkout);
      const setWorktreeBase = vi.spyOn(
        RepositoriesRepository.prototype,
        'setWorktreeBase',
      );

      await expect(
        failureOf(service.setWorktreeBase('owner-a', checkout.id, 'worktrees')),
      ).resolves.toEqual(
        invalidWorktreeBase(
          'A worktree base on a local checkout must be an absolute path.',
        ),
      );

      expect(setWorktreeBase).not.toHaveBeenCalled();
    });

    it('refuses a NUL byte even in an absolute path', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(checkout);
      const setWorktreeBase = vi.spyOn(
        RepositoriesRepository.prototype,
        'setWorktreeBase',
      );

      await expect(
        failureOf(
          service.setWorktreeBase('owner-a', checkout.id, '/srv/work\0trees'),
        ),
      ).resolves.toEqual(
        invalidWorktreeBase(
          'A worktree base on a local checkout must be an absolute path.',
        ),
      );

      expect(setWorktreeBase).not.toHaveBeenCalled();
    });

    it('accepts and canonicalizes a locator of the checkout’s own Machine', async () => {
      const { service } = makeService();
      const machine: Checkout = {
        ...checkout,
        executorId: 'machine:devl',
        path: 'machine://devl/srv/repo',
      };
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(machine);
      const setWorktreeBase = vi
        .spyOn(RepositoriesRepository.prototype, 'setWorktreeBase')
        .mockResolvedValue({
          ...machine,
          worktreeBase: 'machine://devl/srv/a%3Ab',
        });

      // The stored value is the formatter's spelling: the name lowercases and
      // a colon in the last segment re-encodes, so it reads back as one path.
      await expect(
        service.setWorktreeBase(
          'owner-a',
          machine.id,
          'machine://DEVL/srv/a%3Ab',
        ),
      ).resolves.toEqual({
        ...machine,
        worktreeBase: 'machine://devl/srv/a%3Ab',
        chatIds: [],
        leaseChatId: null,
      });

      expect(setWorktreeBase).toHaveBeenCalledWith(
        'owner-a',
        machine.id,
        'machine://devl/srv/a%3Ab',
      );
    });

    it('refuses a locator that names another Machine', async () => {
      const { service } = makeService();
      const machine: Checkout = {
        ...checkout,
        executorId: 'machine:devl',
        path: 'machine://devl/srv/repo',
      };
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(machine);
      const setWorktreeBase = vi.spyOn(
        RepositoriesRepository.prototype,
        'setWorktreeBase',
      );

      await expect(
        failureOf(
          service.setWorktreeBase('owner-a', machine.id, 'machine://other/srv'),
        ),
      ).resolves.toEqual(
        invalidWorktreeBase(
          'A worktree base must name the Machine of its own checkout.',
        ),
      );

      expect(setWorktreeBase).not.toHaveBeenCalled();
    });

    it('refuses a locator that names no path', async () => {
      const { service } = makeService();
      const machine: Checkout = {
        ...checkout,
        executorId: 'machine:devl',
        path: 'machine://devl/srv/repo',
      };
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(machine);
      const setWorktreeBase = vi.spyOn(
        RepositoriesRepository.prototype,
        'setWorktreeBase',
      );

      // `machine://devl` is the roots form: it names a Machine, not a base.
      await expect(
        failureOf(
          service.setWorktreeBase('owner-a', machine.id, 'machine://devl'),
        ),
      ).resolves.toEqual(
        invalidWorktreeBase(
          'A worktree base must name the Machine of its own checkout.',
        ),
      );

      expect(setWorktreeBase).not.toHaveBeenCalled();
    });

    it('refuses a locator on a local checkout', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(checkout);
      const setWorktreeBase = vi.spyOn(
        RepositoriesRepository.prototype,
        'setWorktreeBase',
      );

      await expect(
        failureOf(
          service.setWorktreeBase('owner-a', checkout.id, 'machine://devl/srv'),
        ),
      ).resolves.toEqual(
        invalidWorktreeBase(
          'A worktree base must name the Machine of its own checkout.',
        ),
      );

      expect(setWorktreeBase).not.toHaveBeenCalled();
    });

    it('refuses a host path on a Machine checkout', async () => {
      const { service } = makeService();
      const machine: Checkout = {
        ...checkout,
        executorId: 'machine:devl',
        path: 'machine://devl/srv/repo',
      };
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(machine);
      const setWorktreeBase = vi.spyOn(
        RepositoriesRepository.prototype,
        'setWorktreeBase',
      );

      await expect(
        failureOf(
          service.setWorktreeBase('owner-a', machine.id, '/srv/worktrees'),
        ),
      ).resolves.toEqual(
        invalidWorktreeBase(
          'A worktree base on a Machine checkout must be a machine:// locator.',
        ),
      );

      expect(setWorktreeBase).not.toHaveBeenCalled();
    });

    it('answers 404 when the update removed nothing', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'findCheckout',
      ).mockResolvedValue(checkout);
      vi.spyOn(
        RepositoriesRepository.prototype,
        'setWorktreeBase',
      ).mockResolvedValue(undefined);

      await expect(
        failureOf(
          service.setWorktreeBase('owner-a', checkout.id, '/srv/worktrees'),
        ),
      ).resolves.toMatchObject({ statusCode: 404, code: 'not_found' });
    });
  });

  describe('deleteCheckout', () => {
    it('deletes an owned row and answers nothing', async () => {
      const { service } = makeService();
      const count = vi.spyOn(
        RepositoriesRepository.prototype,
        'countWorktrees',
      );
      const deleteCheckout = vi
        .spyOn(RepositoriesRepository.prototype, 'deleteCheckout')
        .mockResolvedValue(true);

      await expect(
        service.deleteCheckout('owner-a', checkout.id),
      ).resolves.toBeUndefined();

      expect(count).toHaveBeenCalledWith('owner-a', {
        parentCheckoutId: checkout.id,
      });
      expect(deleteCheckout).toHaveBeenCalledWith('owner-a', checkout.id);
    });

    it('refuses a main row that still has worktree children', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'countWorktrees',
      ).mockResolvedValue(2);
      const deleteCheckout = vi.spyOn(
        RepositoriesRepository.prototype,
        'deleteCheckout',
      );

      await expect(
        failureOf(service.deleteCheckout('owner-a', checkout.id)),
      ).resolves.toMatchObject({
        statusCode: 409,
        code: 'worktrees_present',
      });
      expect(deleteCheckout).not.toHaveBeenCalled();
    });

    it('answers 404 when the delete removed nothing', async () => {
      const { service } = makeService();
      vi.spyOn(
        RepositoriesRepository.prototype,
        'deleteCheckout',
      ).mockResolvedValue(false);

      await expect(
        failureOf(service.deleteCheckout('owner-a', checkout.id)),
      ).resolves.toMatchObject({ statusCode: 404, code: 'not_found' });
    });
  });
});
