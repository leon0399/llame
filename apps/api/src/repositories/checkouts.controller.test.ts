import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { type CheckoutRegistrationService } from './checkout-registration.service';
import { CheckoutsController } from './checkouts.controller';
import { type CheckoutSummary, CheckoutsService } from './checkouts.service';
import { type CheckoutResponse, toCheckoutResponse } from './dto/checkouts.dto';

const summary: CheckoutSummary = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'owner-a',
  repositoryId: '1b6f5499-dde4-43cf-89fe-037998a0fe64',
  executorId: 'local-exec',
  path: '/home/me/llame',
  kind: 'main',
  parentCheckoutId: null,
  branch: 'main',
  origin: 'registered',
  worktreeBase: '/srv/worktrees',
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
  chatIds: ['chat-a', 'chat-b'],
  leaseChatId: 'chat-c',
};

const response: CheckoutResponse = {
  id: summary.id,
  repositoryId: summary.repositoryId,
  executorId: summary.executorId,
  path: summary.path,
  kind: summary.kind,
  parentCheckoutId: summary.parentCheckoutId,
  branch: summary.branch,
  origin: summary.origin,
  worktreeBase: summary.worktreeBase,
  chatIds: ['chat-a', 'chat-b'],
  leaseChatId: summary.leaseChatId,
  createdAt: summary.createdAt,
  updatedAt: summary.updatedAt,
};

/**
 * The service's registration dependency: every route under test is spied on
 * the service itself, so this member is never reached. The class carries
 * injected private state, so a structural object cannot name its type.
 */
function unusedRegistration(): CheckoutRegistrationService {
  // SAFETY: no test in this file reaches `register`; the controller tests spy
  // the service method they exercise instead.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return { register: vi.fn() } as never;
}

// The controller is a mapping layer: each route forwards the verified user and
// its inputs to one service call, and hands back the row's public shape.
// `ownerUserId` is not part of that shape, so the mapping cannot leak an owner.
function makeController() {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  const service = new CheckoutsService(tenantDb, unusedRegistration());
  const register = vi.spyOn(service, 'register').mockResolvedValue(summary);
  const listCheckouts = vi
    .spyOn(service, 'listCheckouts')
    .mockResolvedValue([summary]);
  const setWorktreeBase = vi
    .spyOn(service, 'setWorktreeBase')
    .mockResolvedValue(summary);
  const deleteCheckout = vi
    .spyOn(service, 'deleteCheckout')
    .mockResolvedValue(undefined);
  return {
    controller: new CheckoutsController(service),
    register,
    listCheckouts,
    setWorktreeBase,
    deleteCheckout,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CheckoutsController', () => {
  it('registers with the verified user and maps the response', async () => {
    const { controller, register } = makeController();

    await expect(
      controller.registerCheckout('owner-a', { path: '/home/me/llame' }),
    ).resolves.toEqual(response);

    expect(register).toHaveBeenCalledWith('owner-a', {
      path: '/home/me/llame',
    });
  });

  it('lists with the verified user, the query filter, and maps every row', async () => {
    const second = { ...summary, id: '4b6f5499-dde4-43cf-89fe-037998a0fe64' };
    // The mapped row is spelled out rather than spread: `CheckoutResponse` is a
    // class, and a spread would drop its prototype.
    const secondResponse: CheckoutResponse = {
      id: second.id,
      repositoryId: response.repositoryId,
      executorId: response.executorId,
      path: response.path,
      kind: response.kind,
      parentCheckoutId: response.parentCheckoutId,
      branch: response.branch,
      origin: response.origin,
      worktreeBase: response.worktreeBase,
      chatIds: response.chatIds,
      leaseChatId: response.leaseChatId,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
    };
    const { controller, listCheckouts } = makeController();
    listCheckouts.mockResolvedValue([summary, second]);

    await expect(
      controller.listCheckouts('owner-a', {
        repositoryId: summary.repositoryId,
      }),
    ).resolves.toEqual([response, secondResponse]);

    expect(listCheckouts).toHaveBeenCalledWith('owner-a', summary.repositoryId);
  });

  it('updates the worktree base with the verified user and the body value', async () => {
    const { controller, setWorktreeBase } = makeController();

    await expect(
      controller.updateCheckout('owner-a', summary.id, {
        worktreeBase: '/srv/worktrees',
      }),
    ).resolves.toEqual(response);

    expect(setWorktreeBase).toHaveBeenCalledWith(
      'owner-a',
      summary.id,
      '/srv/worktrees',
    );
  });

  it('deletes the row through the service and answers no body', async () => {
    const { controller, deleteCheckout } = makeController();

    await expect(
      controller.deleteCheckout('owner-a', summary.id),
    ).resolves.toBeUndefined();

    expect(deleteCheckout).toHaveBeenCalledWith('owner-a', summary.id);
  });
});

describe('toCheckoutResponse', () => {
  it('passes every row field through and copies the chat ids', () => {
    expect(toCheckoutResponse(summary)).toEqual(response);
  });

  it('copies chatIds into a fresh array', () => {
    // The summary's array is readonly and shared with the row it came from, so
    // the response must not hand a caller that reference.
    expect(toCheckoutResponse(summary).chatIds).not.toBe(summary.chatIds);
    expect(toCheckoutResponse(summary).chatIds).toEqual(['chat-a', 'chat-b']);
  });
});
