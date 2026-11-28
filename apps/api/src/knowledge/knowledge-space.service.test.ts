import { drizzle } from 'drizzle-orm/postgres-js';

import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';
import { KnowledgeSpaceUnavailableError } from './knowledge-space.local-resolver';
import { KnowledgeSpaceService } from './knowledge-space.service';

const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

const SPACE = {
  knowledgeSpaceId: SPACE_ID,
  ownerUserId: 'owner-a',
  name: 'Personal',
  createdAt: new Date('2026-08-23T12:00:00.000Z'),
  updatedAt: new Date('2026-08-23T12:00:00.000Z'),
  archivedAt: null,
};

function fakeDb(): Db {
  return drizzle.mock();
}

function makeService(root: string | undefined) {
  const tx = fakeDb();
  const events: Array<string> = [];

  const runAs: TenantRunner['runAs'] = async (ownerUserId, callback) => {
    events.push(`db:${ownerUserId}`);

    return callback(tx);
  };

  const tenantDb: TenantRunner = { runAs };

  const localResolver = {
    resolveRoot: vi.fn(() => {
      events.push('root');

      if (root === undefined) throw new KnowledgeSpaceUnavailableError();

      return root;
    }),
    ensureChild: vi.fn((_root: string, _id: string) => {
      events.push('child');

      return `${root}/${_id}`;
    }),
    resolveChild: vi.fn(() => `/srv/knowledge/${SPACE_ID}`),
  };

  const service = new KnowledgeSpaceService(tenantDb, localResolver);

  return { service, localResolver, events };
}

describe('KnowledgeSpaceService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('validates the configured root before opening a tenant transaction', async () => {
    const { service, localResolver, events } = makeService(undefined);

    await expect(
      service.provisionForOwner('owner-a', { name: 'Personal' }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceUnavailableError);
    expect(localResolver.resolveRoot).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['root']);
  });

  it('creates and validates the child before inserting the authority row', async () => {
    const { service, localResolver, events } = makeService('/srv/knowledge');
    vi.spyOn(KnowledgeSpaceRepository.prototype, 'create').mockResolvedValue(
      SPACE,
    );

    await expect(
      service.provisionForOwner('owner-a', { name: '  Personal  ' }),
    ).resolves.toEqual({
      id: SPACE_ID,
      name: 'Personal',
      createdAt: SPACE.createdAt,
      updatedAt: SPACE.updatedAt,
      archivedAt: null,
    });
    expect(localResolver.ensureChild).toHaveBeenCalledWith(
      '/srv/knowledge',
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    );
    expect(events).toEqual(['root', 'child', 'db:owner-a']);
  });

  it('leaves an already-created child when database insertion fails', async () => {
    const { localResolver, events } = makeService('/srv/knowledge');
    const databaseError = new Error('database unavailable');
    const runAs: TenantRunner['runAs'] = () => Promise.reject(databaseError);
    const failingService = new KnowledgeSpaceService({ runAs }, localResolver);

    await expect(
      failingService.provisionForOwner('owner-a', { name: 'Personal' }),
    ).rejects.toBe(databaseError);
    expect(localResolver.ensureChild).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['root', 'child']);
  });

  it('lists a bounded owner page and returns a keyset cursor only when needed', async () => {
    const { service } = makeService('/srv/knowledge');

    const second = {
      ...SPACE,
      knowledgeSpaceId: '7f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
      createdAt: new Date('2026-08-23T12:01:00.000Z'),
    };

    const list = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'listForOwnerPage')
      .mockResolvedValue([SPACE, second]);

    const result = await service.listForOwner('owner-a', { limit: 1 });
    expect(result.items).toEqual([
      expect.objectContaining({ id: SPACE_ID, name: 'Personal' }),
    ]);
    expect(result.nextCursor).not.toBeNull();
    expect(list).toHaveBeenCalledWith('owner-a', 1, undefined, 'active');

    await service.listForOwner('owner-a', { limit: 1, archived: 'only' });
    expect(list).toHaveBeenCalledWith('owner-a', 1, undefined, 'only');
  });

  it('resolves compatibility bindings from the earliest deterministic row', async () => {
    const { service, localResolver } = makeService('/srv/knowledge');
    vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    ).mockResolvedValue(SPACE);

    await expect(service.resolveBindingForOwner('owner-a')).resolves.toEqual({
      id: SPACE_ID,
      name: 'Personal',
      root: '/srv/knowledge',
      directory: `/srv/knowledge/${SPACE_ID}`,
    });
    expect(localResolver.resolveChild).toHaveBeenCalledWith(
      '/srv/knowledge',
      SPACE_ID,
    );
  });

  it('reuses the earliest row for legacy no-name provisioning callers', async () => {
    const { service, localResolver, events } = makeService('/srv/knowledge');
    vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    ).mockResolvedValue(SPACE);
    const create = vi.spyOn(KnowledgeSpaceRepository.prototype, 'create');

    await expect(service.provisionForOwner('owner-a')).resolves.toEqual({
      id: SPACE_ID,
      name: 'Personal',
      createdAt: SPACE.createdAt,
      updatedAt: SPACE.updatedAt,
      archivedAt: null,
    });
    expect(localResolver.ensureChild).toHaveBeenCalledWith(
      '/srv/knowledge',
      SPACE_ID,
    );
    expect(create).not.toHaveBeenCalled();
    expect(events).toEqual(['root', 'db:owner-a', 'child']);
  });

  it('refuses to rename an archived space and does not touch the directory', async () => {
    const { service, localResolver } = makeService('/srv/knowledge');
    vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findByIdForOwner',
    ).mockResolvedValue({
      ...SPACE,
      archivedAt: new Date('2026-08-24T00:00:00.000Z'),
    });

    const updateName = vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'updateName',
    );

    await expect(
      service.renameForOwner('owner-a', SPACE_ID, { name: 'Renamed' }),
    ).rejects.toMatchObject({
      response: {
        message:
          'This Knowledge Space is archived. Unarchive it before you rename it.',
      },
    });
    expect(updateName).not.toHaveBeenCalled();
    expect(localResolver.ensureChild).not.toHaveBeenCalled();
    expect(localResolver.resolveChild).not.toHaveBeenCalled();
  });

  it('renames an active space after confirming it is not archived', async () => {
    const { service } = makeService('/srv/knowledge');
    vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findByIdForOwner',
    ).mockResolvedValue(SPACE);

    const updateName = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'updateName')
      .mockResolvedValue({ ...SPACE, name: 'Field notes' });

    await expect(
      service.renameForOwner('owner-a', SPACE_ID, { name: 'Field notes' }),
    ).resolves.toMatchObject({
      id: SPACE_ID,
      name: 'Field notes',
      archivedAt: null,
    });
    expect(updateName).toHaveBeenCalledWith(SPACE_ID, 'owner-a', 'Field notes');
  });

  it('applies archive and rename in an order that keeps a restored name', async () => {
    const { service } = makeService('/srv/knowledge');
    const order: Array<string> = [];

    const projection = {
      id: SPACE_ID,
      name: 'Field notes',
      createdAt: SPACE.createdAt,
      updatedAt: SPACE.updatedAt,
      archivedAt: null,
    };

    vi.spyOn(service, 'setArchiveForOwner').mockImplementation(
      (_owner, _id, archived) => {
        order.push(archived ? 'archive' : 'restore');

        return Promise.resolve({
          ...projection,
          archivedAt: archived ? new Date() : null,
        });
      },
    );
    vi.spyOn(service, 'renameForOwner').mockImplementation(() => {
      order.push('rename');

      return Promise.resolve(projection);
    });
    const get = vi.spyOn(service, 'getForOwner').mockResolvedValue(projection);

    await service.updateForOwner('owner-a', SPACE_ID, {
      name: 'Field notes',
      archived: false,
    });
    await service.updateForOwner('owner-a', SPACE_ID, {
      name: 'Field notes',
      archived: true,
    });
    await service.updateForOwner('owner-a', SPACE_ID, { name: 'Field notes' });
    await expect(
      service.updateForOwner('owner-a', SPACE_ID, {}),
    ).resolves.toEqual(projection);

    expect(order).toEqual(['restore', 'rename', 'rename', 'archive', 'rename']);
    expect(get).toHaveBeenCalledWith('owner-a', SPACE_ID);
  });

  it('stops when a rename finds no Space', async () => {
    const { service } = makeService('/srv/knowledge');
    const setArchive = vi.spyOn(service, 'setArchiveForOwner');
    vi.spyOn(service, 'renameForOwner').mockResolvedValue(undefined);

    await expect(
      service.updateForOwner('owner-a', SPACE_ID, {
        name: 'Field notes',
        archived: true,
      }),
    ).resolves.toBeUndefined();
    expect(setArchive).not.toHaveBeenCalled();
  });

  it('stops when the Space is missing before a later rename', async () => {
    const { service } = makeService('/srv/knowledge');
    const rename = vi.spyOn(service, 'renameForOwner');
    vi.spyOn(service, 'setArchiveForOwner').mockResolvedValue(undefined);

    await expect(
      service.updateForOwner('owner-a', SPACE_ID, {
        name: 'Field notes',
        archived: false,
      }),
    ).resolves.toBeUndefined();
    expect(rename).not.toHaveBeenCalled();
  });

  it('archives without resolving or creating a directory', async () => {
    const { service, localResolver } = makeService('/srv/knowledge');
    const archivedAt = new Date('2026-08-24T00:00:00.000Z');
    vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'setArchived',
    ).mockResolvedValue({
      ...SPACE,
      archivedAt,
    });

    await expect(
      service.setArchiveForOwner('owner-a', SPACE_ID, true),
    ).resolves.toEqual({
      id: SPACE_ID,
      name: 'Personal',
      createdAt: SPACE.createdAt,
      updatedAt: SPACE.updatedAt,
      archivedAt,
    });
    expect(localResolver.resolveRoot).not.toHaveBeenCalled();
    expect(localResolver.ensureChild).not.toHaveBeenCalled();
    expect(localResolver.resolveChild).not.toHaveBeenCalled();
  });

  it('omits an archived space from explicit binding resolution', async () => {
    const { service, localResolver } = makeService('/srv/knowledge');
    vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findByIdForOwner',
    ).mockResolvedValue({
      ...SPACE,
      archivedAt: new Date('2026-08-24T00:00:00.000Z'),
    });

    await expect(
      service.resolveBindingForOwnerById('owner-a', SPACE_ID),
    ).resolves.toBeUndefined();
    expect(localResolver.resolveChild).not.toHaveBeenCalled();
  });
});
