import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';
import { KnowledgeSpaceUnavailableError } from './knowledge-space.local-resolver';
import { KnowledgeSpaceService } from './knowledge-space.service';

const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

function fakeDb(): Db {
  return drizzle.mock({ schema });
}

function makeService(root: string | undefined) {
  const tx = fakeDb();
  const runAsCalls: string[] = [];
  const runAs: TenantRunner['runAs'] = (ownerUserId, callback) => {
    runAsCalls.push(ownerUserId);
    return callback(tx);
  };
  const tenantDb: TenantRunner = { runAs };
  const localResolver = {
    resolveRoot: vi.fn(() => {
      if (root === undefined) throw new KnowledgeSpaceUnavailableError();
      return root;
    }),
    ensureChild: vi.fn(() => `/srv/knowledge/${SPACE_ID}`),
    resolveChild: vi.fn(() => `/srv/knowledge/${SPACE_ID}`),
  };
  const service = new KnowledgeSpaceService(tenantDb, localResolver);
  return { service, localResolver, runAsCalls };
}

describe('KnowledgeSpaceService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('validates the configured root before opening a tenant transaction', async () => {
    const { service, localResolver, runAsCalls } = makeService(undefined);

    await expect(service.provisionForOwner('owner-a')).rejects.toBeInstanceOf(
      KnowledgeSpaceUnavailableError,
    );
    expect(localResolver.resolveRoot).toHaveBeenCalledTimes(1);
    expect(runAsCalls).toEqual([]);
  });

  it('keeps the committed row as the stable retry anchor after child creation fails', async () => {
    const { service, localResolver, runAsCalls } =
      makeService('/srv/knowledge');
    const createOrGet = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'createOrGet')
      .mockResolvedValue({
        knowledgeSpaceId: SPACE_ID,
        ownerUserId: 'owner-a',
      });
    localResolver.ensureChild
      .mockImplementationOnce(() => {
        throw new KnowledgeSpaceUnavailableError();
      })
      .mockReturnValueOnce(`/srv/knowledge/${SPACE_ID}`);

    await expect(service.provisionForOwner('owner-a')).rejects.toBeInstanceOf(
      KnowledgeSpaceUnavailableError,
    );
    await expect(service.provisionForOwner('owner-a')).resolves.toEqual({
      id: SPACE_ID,
    });

    expect(createOrGet).toHaveBeenCalledTimes(2);
    expect(runAsCalls).toEqual(['owner-a', 'owner-a']);
    expect(localResolver.ensureChild).toHaveBeenNthCalledWith(
      2,
      '/srv/knowledge',
      SPACE_ID,
    );
  });

  it('does not expose a local binding in its logical result', async () => {
    const { service } = makeService('/srv/knowledge');
    vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'createOrGet',
    ).mockResolvedValue({
      knowledgeSpaceId: SPACE_ID,
      ownerUserId: 'owner-a',
    });

    const result = await service.provisionForOwner('owner-a');

    expect(result).toEqual({ id: SPACE_ID });
    expect(result).not.toHaveProperty('root');
    expect(result).not.toHaveProperty('directory');
  });

  it('resolves the private binding only from the authenticated owner row', async () => {
    const { service, localResolver, runAsCalls } =
      makeService('/srv/knowledge');
    const findForOwnerForBinding = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'findForOwnerForBinding')
      .mockResolvedValue({
        knowledgeSpaceId: SPACE_ID,
        ownerUserId: 'owner-a',
      });

    await expect(service.resolveBindingForOwner('owner-a')).resolves.toEqual({
      id: SPACE_ID,
      root: '/srv/knowledge',
      directory: `/srv/knowledge/${SPACE_ID}`,
    });
    expect(findForOwnerForBinding).toHaveBeenCalledWith('owner-a');
    expect(runAsCalls).toEqual(['owner-a']);
    expect(localResolver.resolveChild).toHaveBeenCalledWith(
      '/srv/knowledge',
      SPACE_ID,
    );
    expect(localResolver.ensureChild).not.toHaveBeenCalled();
  });
});
