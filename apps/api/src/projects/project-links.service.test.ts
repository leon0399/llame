import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import {
  type Checkout,
  type Project,
  type ProjectRepository,
  type ProjectRepositoryDefault,
  type Repository,
} from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ProjectLinksRepository } from './project-links.repository';
import { ProjectsRepository } from './projects-repository';
import { ProjectsService } from './projects.service';

const INSTANT = new Date('2026-10-24T00:00:00.000Z');
const OWNER = 'verified-user';

function projectRow(overrides: Partial<Project> = {}): Project {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ownerUserId: OWNER,
    name: 'Project',
    description: null,
    createdAt: INSTANT,
    updatedAt: INSTANT,
    archivedAt: null,
    defaultExecutorId: null,
    ...overrides,
  };
}

function linkRow(
  overrides: Partial<ProjectRepository> = {},
): ProjectRepository {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    ownerUserId: OWNER,
    projectId: projectRow().id,
    repositoryId: '22222222-2222-4222-8222-222222222222',
    alias: 'llame',
    isPrimary: false,
    isolation: 'inherit',
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  };
}

function repositoryRow(overrides: Partial<Repository> = {}): Repository {
  return {
    id: linkRow().repositoryId,
    ownerUserId: OWNER,
    displayName: 'llame-core',
    canonicalRemote: 'github.com/leon0399/llame',
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  };
}

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    ownerUserId: OWNER,
    repositoryId: linkRow().repositoryId,
    executorId: 'host',
    path: '/srv/llame',
    kind: 'main',
    parentCheckoutId: null,
    branch: 'master',
    origin: 'registered',
    worktreeBase: null,
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  };
}

function defaultRow(
  overrides: Partial<ProjectRepositoryDefault> = {},
): ProjectRepositoryDefault {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    ownerUserId: OWNER,
    projectRepositoryId: linkRow().id,
    executorId: 'host',
    checkoutId: checkoutRow().id,
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  };
}

function makeService() {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  );
  return new ProjectsService(tenantDb);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectsService project links', () => {
  it('defaults the alias to the repository display name', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow(),
    );
    const findRepository = vi
      .spyOn(ProjectLinksRepository.prototype, 'findRepository')
      .mockResolvedValue(repositoryRow());
    const createLink = vi
      .spyOn(ProjectLinksRepository.prototype, 'createLink')
      .mockResolvedValue(linkRow({ alias: 'llame-core' }));
    const clearPrimary = vi.spyOn(
      ProjectLinksRepository.prototype,
      'clearPrimary',
    );

    const created = await makeService().linkRepository(OWNER, 'project-1', {
      repositoryId: linkRow().repositoryId,
    });

    expect(created.alias).toBe('llame-core');
    expect(findRepository).toHaveBeenCalledWith(OWNER, linkRow().repositoryId);
    expect(clearPrimary).not.toHaveBeenCalled();
    expect(createLink).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      projectId: projectRow().id,
      repositoryId: linkRow().repositoryId,
      alias: 'llame-core',
      isPrimary: false,
      isolation: 'inherit',
    });
  });

  it('clears the previous primary before it links the new one', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow(),
    );
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findRepository',
    ).mockResolvedValue(repositoryRow());
    const clearPrimary = vi
      .spyOn(ProjectLinksRepository.prototype, 'clearPrimary')
      .mockResolvedValue(undefined);
    vi.spyOn(ProjectLinksRepository.prototype, 'createLink').mockResolvedValue(
      linkRow({ isPrimary: true }),
    );

    await makeService().linkRepository(OWNER, 'project-1', {
      repositoryId: linkRow().repositoryId,
      isPrimary: true,
      isolation: 'always_worktree',
    });

    expect(clearPrimary).toHaveBeenCalledWith(OWNER, projectRow().id);
  });

  it('answers 409 when the project already links the repository', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow(),
    );
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findRepository',
    ).mockResolvedValue(repositoryRow());
    vi.spyOn(ProjectLinksRepository.prototype, 'createLink').mockResolvedValue(
      undefined,
    );

    await expect(
      makeService().linkRepository(OWNER, 'project-1', {
        repositoryId: linkRow().repositoryId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 404 for a repository the caller does not own', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow(),
    );
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findRepository',
    ).mockResolvedValue(undefined);

    await expect(
      makeService().linkRepository(OWNER, 'project-1', {
        repositoryId: linkRow().repositoryId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 for a missing project and 409 for an archived one', async () => {
    const findById = vi
      .spyOn(ProjectsRepository.prototype, 'findById')
      .mockResolvedValue(undefined);

    await expect(
      makeService().linkRepository(OWNER, 'project-1', {
        repositoryId: linkRow().repositoryId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    findById.mockResolvedValue(projectRow({ archivedAt: INSTANT }));
    await expect(
      makeService().unlinkRepository(
        OWNER,
        'project-1',
        linkRow().repositoryId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('clears the primary flag before it updates a link', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow(),
    );
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findLinkByRepository',
    ).mockResolvedValue(linkRow());
    const clearPrimary = vi
      .spyOn(ProjectLinksRepository.prototype, 'clearPrimary')
      .mockResolvedValue(undefined);
    const updateLink = vi
      .spyOn(ProjectLinksRepository.prototype, 'updateLink')
      .mockResolvedValue(linkRow({ isPrimary: true }));

    await makeService().updateProjectRepository(
      OWNER,
      'project-1',
      linkRow().repositoryId,
      { isPrimary: true, alias: 'core' },
    );

    expect(clearPrimary).toHaveBeenCalledWith(OWNER, projectRow().id);
    expect(updateLink).toHaveBeenCalledWith(OWNER, linkRow().id, {
      isPrimary: true,
      alias: 'core',
    });
  });

  it('answers 404 when the project does not link the repository', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow(),
    );
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findLinkByRepository',
    ).mockResolvedValue(undefined);

    await expect(
      makeService().updateProjectRepository(
        OWNER,
        'project-1',
        linkRow().repositoryId,
        { alias: 'core' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      makeService().unlinkRepository(
        OWNER,
        'project-1',
        linkRow().repositoryId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes one link and leaves the repository alone', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow(),
    );
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findLinkByRepository',
    ).mockResolvedValue(linkRow());
    const deleteLink = vi
      .spyOn(ProjectLinksRepository.prototype, 'deleteLink')
      .mockResolvedValue(true);

    await makeService().unlinkRepository(
      OWNER,
      'project-1',
      linkRow().repositoryId,
    );

    expect(deleteLink).toHaveBeenCalledWith(
      OWNER,
      projectRow().id,
      linkRow().id,
    );
  });

  it('groups each default under its link', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow(),
    );
    const other = linkRow({
      id: '77777777-7777-4777-8777-777777777777',
      repositoryId: '33333333-3333-4333-8333-333333333333',
    });
    vi.spyOn(ProjectLinksRepository.prototype, 'listLinks').mockResolvedValue([
      linkRow(),
      other,
    ]);
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'listDefaults',
    ).mockResolvedValue([
      defaultRow(),
      defaultRow({
        id: '88888888-8888-4888-8888-888888888888',
        projectRepositoryId: other.id,
        executorId: 'machine:nas',
        updatedAt: INSTANT,
      }),
    ]);

    const rows = await makeService().listProjectRepositories(
      OWNER,
      'project-1',
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].defaults.map((row) => row.projectRepositoryId)).toEqual([
      linkRow().id,
    ]);
    expect(rows[1].defaults.map((row) => row.executorId)).toEqual([
      'machine:nas',
    ]);
  });

  it('answers 404 when the project of a link read is missing', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      undefined,
    );

    await expect(
      makeService().listProjectRepositories(OWNER, 'project-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProjectsService start-location preview', () => {
  it('resolves the location from the project data', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      projectRow({ defaultExecutorId: 'host' }),
    );
    vi.spyOn(ProjectLinksRepository.prototype, 'listLinks').mockResolvedValue([
      linkRow({ isolation: 'always_worktree' }),
    ]);
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findLatestDefault',
    ).mockResolvedValue(undefined);
    vi.spyOn(ProjectLinksRepository.prototype, 'findDefault').mockResolvedValue(
      undefined,
    );
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'listMainCheckouts',
    ).mockResolvedValue([checkoutRow()]);
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findCheckout',
    ).mockResolvedValue(checkoutRow());

    await expect(
      makeService().getStartLocation(OWNER, 'project-1', {}),
    ).resolves.toEqual({
      repositoryId: linkRow().repositoryId,
      executorId: 'host',
      checkoutId: checkoutRow().id,
      isolation: 'worktree',
      isolationReason: 'project_policy',
      isolationChats: 0,
    });
  });

  it('answers 404 for a missing project', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      undefined,
    );

    await expect(
      makeService().getStartLocation(OWNER, 'project-1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProjectsService project defaults', () => {
  it('stores the source main checkout of a link on its executor', async () => {
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findLinkById',
    ).mockResolvedValue(linkRow());
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findCheckout',
    ).mockResolvedValue(checkoutRow());
    const upsert = vi
      .spyOn(ProjectLinksRepository.prototype, 'upsertDefault')
      .mockResolvedValue(defaultRow());

    await expect(
      makeService().recordProjectDefault(
        OWNER,
        linkRow().id,
        'host',
        checkoutRow().id,
      ),
    ).resolves.toEqual(defaultRow());
    expect(upsert).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      projectRepositoryId: linkRow().id,
      executorId: 'host',
      checkoutId: checkoutRow().id,
    });
  });

  it('refuses a worktree checkout as a defaults target', async () => {
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findLinkById',
    ).mockResolvedValue(linkRow());
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findCheckout',
    ).mockResolvedValue(checkoutRow({ kind: 'worktree' }));
    const upsert = vi.spyOn(ProjectLinksRepository.prototype, 'upsertDefault');

    await expect(
      makeService().recordProjectDefault(
        OWNER,
        linkRow().id,
        'host',
        checkoutRow().id,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('answers 404 for a link of another owner', async () => {
    vi.spyOn(
      ProjectLinksRepository.prototype,
      'findLinkById',
    ).mockResolvedValue(undefined);

    await expect(
      makeService().recordProjectDefault(
        OWNER,
        linkRow().id,
        'host',
        checkoutRow().id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
