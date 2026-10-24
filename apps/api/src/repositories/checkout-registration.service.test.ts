import { HttpException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Stats } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type * as NodeFsPromises from 'node:fs/promises';
import type { MockInstance } from 'vitest';
import { z } from 'zod';

import * as schema from '../db/schema';
import {
  type Checkout,
  type Repository,
  type RepositoryAlias,
} from '../db/schema';
import {
  type GitInspectResult,
  type GitInspectSuccess,
} from '@workspace/git-executor';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  type LlameConfig,
  BUILT_IN_DEFAULTS,
} from '../instance-config/llame-config';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { type PermissionGroup } from '../tools/permissions/types';
import {
  ExecutorGit,
  localGitSurface,
  type LocalGit,
} from '../machines/executor-git.service';
import { MachineConnector } from '../machines/machine-connector.service';
import { createProtocolPeer } from '../testing/machine-protocol-peer';
import { CheckoutRegistrationService } from './checkout-registration.service';
import { RepositoriesRepository } from './repositories.repository';

/*
 * The unit half of checkout registration: the gate order, the canonical-path
 * probes, and every data-layer branch. The stored rows, the owner isolation,
 * and the same-path conflict run against real Postgres in
 * `checkouts.integration.test.ts`, which the mutation runner excludes.
 */

// Both probes are module-level imports of the service, so the suite owns them:
// a canonical-path branch needs a `realpath`/`stat` outcome a real directory
// cannot produce on demand.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return {
    ...actual,
    realpath: vi.fn(actual.realpath),
    stat: vi.fn(actual.stat),
  };
});

const OWNER = 'owner-a';
const EXECUTOR = 'test-host';
const ORIGIN = 'github.com/owner/proj';
const CREATED_AT = new Date('2026-10-24T00:00:00.000Z');
const REPOSITORY_ID = '0b6f5499-dde4-43cf-89fe-037998a0fe64';
const OTHER_REPOSITORY_ID = '7a1d2c3b-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const PARENT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

const ALLOWED_LOCAL: Partial<LlameConfig['tools']> = {
  nativeExecutorId: EXECUTOR,
  allowed: ['enter_workspace'],
};

// A field clause, not `allow: true`: a whole-tool allow would keep admitting a
// call whose `path` argument went missing.
const ANY_ABSOLUTE_PATH: PermissionGroup = {
  allow: [{ field: 'path', regex: '^/' }],
};

const repository: Repository = {
  id: REPOSITORY_ID,
  ownerUserId: OWNER,
  displayName: 'proj',
  canonicalRemote: ORIGIN,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: CHILD_ID,
    ownerUserId: OWNER,
    repositoryId: REPOSITORY_ID,
    executorId: EXECUTOR,
    path: '/work/proj',
    kind: 'main',
    parentCheckoutId: null,
    branch: 'main',
    origin: 'registered',
    worktreeBase: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function aliasRow(canonicalAlias: string): RepositoryAlias {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    ownerUserId: OWNER,
    repositoryId: REPOSITORY_ID,
    canonicalAlias,
    createdAt: CREATED_AT,
  };
}

/** A `stat` result whose only consulted member is `isDirectory`. */
function statsOf(isDirectory: boolean): Stats {
  // SAFETY: the canonical-directory probe asks `isDirectory()` and nothing
  // else, so every other `Stats` member is unreachable from this code path.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return { isDirectory: () => isDirectory } as never;
}

function inspected(
  overrides: Partial<GitInspectSuccess> = {},
): GitInspectSuccess {
  const toplevel = overrides.toplevel ?? '/work/proj';
  return {
    status: 'ok',
    commonDir: `${toplevel}/.git`,
    linked: false,
    mainWorktree: null,
    remotes: [{ name: 'origin', url: 'https://github.com/owner/proj.git' }],
    branch: 'main',
    head: 'a'.repeat(40),
    ...overrides,
    toplevel,
  };
}

/** The Machine connectors one case opened, closed with the case. */
const opened: Array<MachineConnector> = [];

function makeService(options: {
  readonly tools?: Partial<LlameConfig['tools']>;
  readonly group?: PermissionGroup;
  readonly inspection?: GitInspectResult;
}) {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
      callback(db),
  );
  const inspect = vi
    .fn<LocalGit['inspect']>()
    .mockResolvedValue(options.inspection ?? inspected());
  // The real dispatch runs, over a local surface whose one operation the case
  // controls: the canonical probe is the shipped one.
  const local: LocalGit = { ...localGitSurface(), inspect };
  const connector = new MachineConnector({
    hubVersion: 'test-hub',
    machines: undefined,
    transportFactory: createProtocolPeer().factory,
    idleCloseMs: 1000,
  });
  opened.push(connector);
  const config = {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      ...(options.tools ?? ALLOWED_LOCAL),
    },
  };
  const service = new CheckoutRegistrationService(
    tenantDb,
    { config },
    new ExecutorGit({ config }, connector, local),
    compileToolPermissionMap(
      { enter_workspace: options.group ?? ANY_ABSOLUTE_PATH },
      'test-policy',
    ),
  );
  return { service, inspect };
}

// The data layer is one seam: every query reads a stub, so each branch of the
// resolver is reachable without Postgres.
type StubbedData = {
  readonly findRepository: MockInstance<
    RepositoriesRepository['findRepository']
  >;
  readonly findRepositoryByRemote: MockInstance<
    RepositoriesRepository['findRepositoryByRemote']
  >;
  readonly findRepositoryByAlias: MockInstance<
    RepositoriesRepository['findRepositoryByAlias']
  >;
  readonly findCheckoutByPath: MockInstance<
    RepositoriesRepository['findCheckoutByPath']
  >;
  readonly createRepository: MockInstance<
    RepositoriesRepository['createRepository']
  >;
  readonly createCheckout: MockInstance<
    RepositoriesRepository['createCheckout']
  >;
  readonly listAliases: MockInstance<RepositoriesRepository['listAliases']>;
  readonly lockRemoteClaim: MockInstance<
    RepositoriesRepository['lockRemoteClaim']
  >;
};

function stubbedData(): StubbedData {
  return {
    findRepository: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepository')
      .mockResolvedValue(undefined),
    findRepositoryByRemote: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepositoryByRemote')
      .mockResolvedValue(undefined),
    findRepositoryByAlias: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepositoryByAlias')
      .mockResolvedValue(undefined),
    findCheckoutByPath: vi
      .spyOn(RepositoriesRepository.prototype, 'findCheckoutByPath')
      .mockResolvedValue(undefined),
    createRepository: vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue(repository),
    createCheckout: vi
      .spyOn(RepositoriesRepository.prototype, 'createCheckout')
      .mockResolvedValue(checkoutRow()),
    listAliases: vi
      .spyOn(RepositoriesRepository.prototype, 'listAliases')
      .mockResolvedValue([]),
    lockRemoteClaim: vi
      .spyOn(RepositoriesRepository.prototype, 'lockRemoteClaim')
      .mockResolvedValue(undefined),
  };
}

let data: StubbedData;

beforeEach(() => {
  vi.resetAllMocks();
  // A path that exists and is a directory, unless a test says otherwise.
  vi.mocked(realpath).mockImplementation((value) =>
    Promise.resolve(String(value)),
  );
  vi.mocked(stat).mockResolvedValue(statsOf(true));
  data = stubbedData();
});

const failureSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
  code: z.string(),
});

/** The typed body an HttpException answers with. */
async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException)
      return failureSchema.parse(error.getResponse());
    throw error;
  }
  throw new Error('expected the call to fail');
}

afterEach(() => {
  for (const connector of opened.splice(0)) connector.onModuleDestroy();
  vi.restoreAllMocks();
});

/**
 * The gate order, which no HTTP suite can prove: a refusal that comes before
 * the probe answers 403 even though the path does not exist.
 */
describe('CheckoutRegistrationService gates', () => {
  it('refuses a relative path as invalid input', async () => {
    const { service } = makeService({});

    await expect(
      failureOf(service.register(OWNER, { path: 'srv/app' })),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'A checkout path must be absolute.',
      code: 'invalid_path',
    });
  });

  it('refuses a path carrying a NUL byte before any probe', async () => {
    const { service, inspect } = makeService({});

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj\0' })),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'A checkout path must not contain a NUL byte.',
      code: 'invalid_path',
    });
    expect(realpath).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });

  it('refuses a machine:// locator naming no configured Machine', async () => {
    const { service, inspect } = makeService({});

    // A Machine path runs on its daemon; storing a row this hub cannot reach is
    // worse than refusing, so the derivation fails before any probe.
    await expect(
      failureOf(
        service.register(OWNER, { path: `machine://${EXECUTOR}/work/proj` }),
      ),
    ).resolves.toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: `No Machine named ${EXECUTOR} is configured, so its git surface cannot run.`,
      code: 'executor_unavailable',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('refuses when tools.allowed omits the workspace group', async () => {
    const { service, inspect } = makeService({
      tools: { nativeExecutorId: EXECUTOR, allowed: [] },
    });

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message:
        'enter_workspace is not in tools.allowed, so this path may not be inspected.',
      code: 'tool_not_allowed',
    });
    expect(realpath).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });

  it('refuses when the serving process holds no native executor id', async () => {
    const { service, inspect } = makeService({
      tools: { allowed: ['enter_workspace'] },
    });

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message:
        'The serving process holds no tools.nativeExecutorId, so it cannot run git for a local path.',
      code: 'executor_unavailable',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('decides the submitted path before probing it', async () => {
    const { service, inspect } = makeService({
      group: { reject: true, allow: true },
    });

    // The path does not exist: a probe would answer 422, so a 403 proves the
    // decision came first.
    await expect(
      failureOf(service.register(OWNER, { path: '/no/such/checkout' })),
    ).resolves.toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'The host access policy does not allow this path.',
      code: 'permission_denied',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('decides the canonical path before inspecting it', async () => {
    const { service, inspect } = makeService({
      group: { allow: [{ field: 'path', literal: '/work/proj/sub' }] },
    });
    // A symlink target outside the allow list is refused even though the
    // submitted path was admitted.
    vi.mocked(realpath).mockResolvedValue('/work/elsewhere');

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj/sub' })),
    ).resolves.toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'The host access policy does not allow this path.',
      code: 'permission_denied',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('decides the main clone of a worktree before storing it', async () => {
    const { service, inspect } = makeService({
      group: {
        allow: [{ field: 'path', regex: '^/' }],
        reject: [{ field: 'path', literal: '/work/proj' }],
      },
      inspection: inspected({
        toplevel: '/work/wt',
        linked: true,
        mainWorktree: '/work/proj',
      }),
    });

    await expect(
      failureOf(service.register(OWNER, { path: '/work/wt' })),
    ).resolves.toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'The host access policy does not allow this path.',
      code: 'permission_denied',
    });
    expect(inspect).toHaveBeenCalledWith({ path: '/work/wt' });
    expect(data.createCheckout).not.toHaveBeenCalled();
  });

  it('decides the toplevel of a worktree registered through a subdirectory', async () => {
    const { service, inspect } = makeService({
      group: {
        allow: [{ field: 'path', regex: '^/' }],
        // Anchored: a literal is a substring search, so `/work/wt` would also
        // match the subdirectory this case submits.
        reject: [{ field: 'path', regex: '^/work/wt$' }],
      },
      inspection: inspected({
        toplevel: '/work/wt',
        linked: true,
        mainWorktree: '/work/proj',
      }),
    });
    vi.mocked(realpath).mockResolvedValue('/work/wt/sub');

    // The submitted and canonical paths are this worktree's subdirectory and
    // its main clone is another directory, so only the inspected toplevel is
    // rejected — the row would have been stored at a path the operator refused.
    await expect(
      failureOf(service.register(OWNER, { path: '/work/wt/sub' })),
    ).resolves.toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'The host access policy does not allow this path.',
      code: 'permission_denied',
    });
    expect(inspect).toHaveBeenCalledWith('/work/wt/sub');
    expect(data.createCheckout).not.toHaveBeenCalled();
  });
});

describe('canonical directory probes', () => {
  it('answers 422 when the path does not exist', async () => {
    const { service, inspect } = makeService({});
    vi.mocked(realpath).mockRejectedValue(new Error('ENOENT'));

    await expect(
      failureOf(service.register(OWNER, { path: '/work/missing' })),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'The checkout path does not exist.',
      code: 'invalid_path',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('answers 422 when the canonical path cannot be read', async () => {
    const { service, inspect } = makeService({});
    vi.mocked(stat).mockRejectedValue(new Error('EACCES'));

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'The checkout path cannot be read.',
      code: 'invalid_path',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('answers 422 when the path is not a directory', async () => {
    const { service, inspect } = makeService({});
    vi.mocked(stat).mockResolvedValue(statsOf(false));

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj/README.md' })),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'The checkout path is not a directory.',
      code: 'not_a_directory',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('inspects the canonical path, not the submitted one', async () => {
    const { service, inspect } = makeService({});
    vi.mocked(realpath).mockResolvedValue('/work/proj');

    await service.register(OWNER, { path: '/work/proj/sub' });

    expect(inspect).toHaveBeenCalledWith({ path: '/work/proj' });
    // The stored path is the toplevel git reports, so a subdirectory records
    // the clone once.
    expect(data.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/work/proj' }),
    );
  });
});

describe('git inspection failures', () => {
  it('maps invalid_input to a 422 with its own message', async () => {
    const { service } = makeService({
      inspection: {
        status: 'error',
        type: 'invalid_input',
        message: 'The path must be absolute.',
      },
    });

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'The path must be absolute.',
      code: 'invalid_path',
    });
  });

  it('maps not_a_repository to a 422', async () => {
    const { service } = makeService({
      inspection: {
        status: 'error',
        type: 'not_a_repository',
        stderr: 'fatal: not a git repository',
      },
    });

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'The path holds no git repository.',
      code: 'not_a_repository',
    });
    expect(data.createCheckout).not.toHaveBeenCalled();
  });

  it('maps timed_out to a 502', async () => {
    const { service } = makeService({
      inspection: { status: 'error', type: 'timed_out', stderr: 'killed' },
    });

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 502,
      error: 'Bad Gateway',
      message: 'Inspection did not finish within its timeout.',
      code: 'git_failed',
    });
  });

  it('maps git_failed without stderr to a bare failure message', async () => {
    const { service } = makeService({
      inspection: { status: 'error', type: 'git_failed', stderr: '' },
    });

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 502,
      error: 'Bad Gateway',
      message: 'Inspection failed.',
      code: 'git_failed',
    });
  });

  it('carries the bounded stderr of a git_failed inspection', async () => {
    const { service } = makeService({
      inspection: {
        status: 'error',
        type: 'git_failed',
        stderr: 'fatal: bad object HEAD',
      },
    });

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 502,
      error: 'Bad Gateway',
      message: 'Inspection failed: fatal: bad object HEAD',
      code: 'git_failed',
    });
  });
});

describe('storing the checkout', () => {
  it('records a main clone with no parent', async () => {
    const { service, inspect } = makeService({});
    const created = checkoutRow();
    data.createCheckout.mockResolvedValue(created);

    await expect(service.register(OWNER, { path: '/work/proj' })).resolves.toBe(
      created,
    );

    expect(inspect).toHaveBeenCalledWith({ path: '/work/proj' });
    expect(data.createRepository).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      displayName: 'proj',
      canonicalRemote: ORIGIN,
    });
    expect(data.createCheckout).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      repositoryId: REPOSITORY_ID,
      executorId: EXECUTOR,
      path: '/work/proj',
      kind: 'main',
      parentCheckoutId: null,
      branch: 'main',
      origin: 'registered',
    });
  });

  it('records a linked worktree under its recorded main clone', async () => {
    const { service } = makeService({
      inspection: inspected({
        toplevel: '/work/wt',
        linked: true,
        mainWorktree: '/work/proj',
        branch: 'feature',
      }),
    });
    vi.mocked(realpath).mockResolvedValue('/work/wt');
    const parent = checkoutRow({ id: PARENT_ID, path: '/work/proj' });
    data.findCheckoutByPath.mockResolvedValue(parent);
    data.findRepository.mockResolvedValue(repository);
    const created = checkoutRow({
      id: CHILD_ID,
      path: '/work/wt',
      kind: 'worktree',
      parentCheckoutId: PARENT_ID,
      branch: 'feature',
    });
    data.createCheckout.mockResolvedValue(created);

    await expect(service.register(OWNER, { path: '/work/wt' })).resolves.toBe(
      created,
    );

    expect(data.findCheckoutByPath).toHaveBeenCalledWith(
      OWNER,
      EXECUTOR,
      '/work/proj',
    );
    expect(data.createCheckout).toHaveBeenCalledTimes(1);
    expect(data.createCheckout).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      repositoryId: REPOSITORY_ID,
      executorId: EXECUTOR,
      path: '/work/wt',
      kind: 'worktree',
      parentCheckoutId: PARENT_ID,
      branch: 'feature',
      origin: 'registered',
    });
  });

  it('answers 409 when the executor path is already taken', async () => {
    const { service } = makeService({});
    data.createCheckout.mockResolvedValue(undefined);

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'This executor path is already one of your checkouts.',
      code: 'path_taken',
    });
  });
});

describe('repository selectors', () => {
  it('refuses both selectors at once', async () => {
    const { service } = makeService({});

    await expect(
      failureOf(
        service.register(OWNER, {
          path: '/work/proj',
          repositoryId: REPOSITORY_ID,
          remote: ORIGIN,
        }),
      ),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Submit repositoryId or remote as the selector, not both.',
      code: 'invalid_selector',
    });
    expect(data.findRepository).not.toHaveBeenCalled();
  });

  it('selects by repository id and lets the origin agree', async () => {
    const { service } = makeService({});
    data.findRepository.mockResolvedValue(repository);

    await service.register(OWNER, {
      path: '/work/proj',
      repositoryId: REPOSITORY_ID,
    });

    expect(data.findRepository).toHaveBeenCalledWith(OWNER, REPOSITORY_ID);
    expect(data.findRepositoryByRemote).not.toHaveBeenCalled();
    // The inspected origin already equals the row's remote, so no alias is read.
    expect(data.listAliases).not.toHaveBeenCalled();
    expect(data.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: REPOSITORY_ID }),
    );
  });

  it('selects by a normalized remote', async () => {
    const { service } = makeService({});
    data.findRepositoryByRemote.mockResolvedValue(repository);

    await service.register(OWNER, {
      path: '/work/proj',
      remote: ' https://github.com/Owner/Proj.git ',
    });

    // The scheme, userinfo, and `.git` suffix are gone; the path keeps its case
    // so a case-sensitive host is not silently merged with another.
    expect(data.findRepositoryByRemote).toHaveBeenCalledWith(
      OWNER,
      'github.com/Owner/Proj',
    );
    expect(data.findRepositoryByAlias).not.toHaveBeenCalled();
  });

  it('falls back to a declared alias when no remote matches', async () => {
    const { service } = makeService({});
    data.findRepositoryByAlias.mockResolvedValue(repository);

    await service.register(OWNER, { path: '/work/proj', remote: ORIGIN });

    expect(data.findRepositoryByRemote).toHaveBeenCalledWith(OWNER, ORIGIN);
    expect(data.findRepositoryByAlias).toHaveBeenCalledWith(OWNER, ORIGIN);
    expect(data.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: REPOSITORY_ID }),
    );
  });

  it('answers 404 when a remote selects nothing', async () => {
    const { service } = makeService({});

    await expect(
      failureOf(
        service.register(OWNER, { path: '/work/proj', remote: ORIGIN }),
      ),
    ).resolves.toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Repository record not found',
      code: 'not_found',
    });
  });

  it('answers 404 when a repository id selects nothing', async () => {
    const { service } = makeService({});

    await expect(
      failureOf(
        service.register(OWNER, {
          path: '/work/proj',
          repositoryId: REPOSITORY_ID,
        }),
      ),
    ).resolves.toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Repository record not found',
      code: 'not_found',
    });
  });
});

describe('adoption of an unselected repository', () => {
  it('reuses the row already recorded at the inspected origin', async () => {
    const { service } = makeService({});
    data.findRepositoryByRemote.mockResolvedValue(repository);

    await service.register(OWNER, { path: '/work/proj' });

    expect(data.findRepositoryByRemote).toHaveBeenCalledWith(OWNER, ORIGIN);
    expect(data.createRepository).not.toHaveBeenCalled();
  });

  it('reuses the row a declared alias names', async () => {
    const { service } = makeService({});
    data.findRepositoryByAlias.mockResolvedValue(repository);

    await service.register(OWNER, { path: '/work/proj' });

    expect(data.findRepositoryByAlias).toHaveBeenCalledWith(OWNER, ORIGIN);
    expect(data.createRepository).not.toHaveBeenCalled();
  });

  it('creates the repository the origin names', async () => {
    const { service } = makeService({});

    await service.register(OWNER, { path: '/work/proj' });

    expect(data.createRepository).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      displayName: 'proj',
      canonicalRemote: ORIGIN,
    });
  });

  it("reads the winner of a concurrent adoption's insert race", async () => {
    const { service } = makeService({});
    data.findRepositoryByRemote
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(repository);
    data.createRepository.mockResolvedValue(undefined);

    await service.register(OWNER, { path: '/work/proj' });

    expect(data.createRepository).toHaveBeenCalledTimes(1);
    expect(data.findRepositoryByRemote).toHaveBeenCalledTimes(2);
    expect(data.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: REPOSITORY_ID }),
    );
  });

  it('answers 404 when the insert race winner is unreadable', async () => {
    const { service } = makeService({});
    data.createRepository.mockResolvedValue(undefined);

    await expect(
      failureOf(service.register(OWNER, { path: '/work/proj' })),
    ).resolves.toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Repository record not found',
      code: 'not_found',
    });
  });

  it('refuses a lost insert race on a remote-less clone', async () => {
    const { service } = makeService({
      inspection: inspected({ remotes: [] }),
    });
    data.createRepository.mockResolvedValue(undefined);

    // A NULL remote never conflicts on the unique key, so reaching here is a
    // programming error rather than a race to resolve.
    await expect(
      service.register(OWNER, { path: '/work/proj' }),
    ).rejects.toThrow('A remote-less repository cannot lose an insert race.');
    expect(data.findRepositoryByRemote).not.toHaveBeenCalled();
  });
});

describe('origin agreement', () => {
  it('joins a recorded repository for a clone without an origin', async () => {
    const { service } = makeService({
      inspection: inspected({
        toplevel: '/work/wt',
        linked: true,
        mainWorktree: '/work/proj',
        remotes: [],
      }),
    });
    vi.mocked(realpath).mockResolvedValue('/work/wt');
    data.findCheckoutByPath.mockResolvedValue(
      checkoutRow({ id: PARENT_ID, path: '/work/proj' }),
    );
    data.findRepository.mockResolvedValue({
      ...repository,
      canonicalRemote: 'github.com/elsewhere/other',
    });

    await service.register(OWNER, { path: '/work/wt' });

    // The recorded row keeps the identity the first checkout gave it.
    expect(data.listAliases).not.toHaveBeenCalled();
    expect(data.createRepository).not.toHaveBeenCalled();
  });

  it('accepts a declared alias as the same origin', async () => {
    const { service } = makeService({});
    data.findRepositoryByRemote.mockResolvedValue({
      ...repository,
      canonicalRemote: 'github.com/old/proj',
    });
    data.listAliases.mockResolvedValue([aliasRow(ORIGIN)]);

    await service.register(OWNER, { path: '/work/proj', remote: ORIGIN });

    expect(data.listAliases).toHaveBeenCalledWith(OWNER, REPOSITORY_ID);
    expect(data.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: REPOSITORY_ID }),
    );
  });

  it('refuses an origin no declared alias matches', async () => {
    const { service } = makeService({});
    data.findRepositoryByRemote.mockResolvedValue({
      ...repository,
      canonicalRemote: 'github.com/old/proj',
    });
    data.listAliases.mockResolvedValue([aliasRow('github.com/fork/proj')]);

    await expect(
      failureOf(
        service.register(OWNER, { path: '/work/proj', remote: ORIGIN }),
      ),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'The inspected origin does not match the declared repository.',
      code: 'origin_mismatch',
    });
  });

  it('refuses an origin when no alias is declared at all', async () => {
    const { service } = makeService({});
    data.findRepositoryByRemote.mockResolvedValue({
      ...repository,
      canonicalRemote: 'github.com/old/proj',
    });

    await expect(
      failureOf(
        service.register(OWNER, { path: '/work/proj', remote: ORIGIN }),
      ),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'The inspected origin does not match the declared repository.',
      code: 'origin_mismatch',
    });
  });
});

describe('the main clone of a worktree', () => {
  function worktreeService(
    inspection: GitInspectSuccess = inspected({
      toplevel: '/work/wt',
      linked: true,
      mainWorktree: '/work/proj',
      branch: 'feature',
    }),
  ) {
    const made = makeService({ inspection });
    vi.mocked(realpath).mockResolvedValue('/work/wt');
    return made;
  }

  it('adopts an unrecorded main clone next to the worktree', async () => {
    const { service } = worktreeService();
    const parent = checkoutRow({
      id: PARENT_ID,
      path: '/work/proj',
      branch: null,
      origin: 'adopted',
    });
    const created = checkoutRow({
      id: CHILD_ID,
      path: '/work/wt',
      kind: 'worktree',
      parentCheckoutId: PARENT_ID,
      branch: 'feature',
    });
    data.createCheckout
      .mockResolvedValueOnce(parent)
      .mockResolvedValueOnce(created);

    await expect(service.register(OWNER, { path: '/work/wt' })).resolves.toBe(
      created,
    );

    // The inspection read the worktree's HEAD, so the adopted parent records
    // intent only: no branch, and the row it was not registered before.
    expect(data.createCheckout).toHaveBeenNthCalledWith(1, {
      ownerUserId: OWNER,
      repositoryId: REPOSITORY_ID,
      executorId: EXECUTOR,
      path: '/work/proj',
      kind: 'main',
      parentCheckoutId: null,
      branch: null,
      origin: 'adopted',
    });
    expect(data.createCheckout).toHaveBeenNthCalledWith(2, {
      ownerUserId: OWNER,
      repositoryId: REPOSITORY_ID,
      executorId: EXECUTOR,
      path: '/work/wt',
      kind: 'worktree',
      parentCheckoutId: PARENT_ID,
      branch: 'feature',
      origin: 'registered',
    });
  });

  it('reads the parent a concurrent registration adopted first', async () => {
    const { service } = worktreeService();
    const parent = checkoutRow({ id: PARENT_ID, path: '/work/proj' });
    const created = checkoutRow({
      id: CHILD_ID,
      path: '/work/wt',
      kind: 'worktree',
      parentCheckoutId: PARENT_ID,
    });
    // The parent lookup misses twice, the insert loses, and the committed row
    // of the winner is visible to the third read.
    data.findCheckoutByPath
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(parent);
    data.createCheckout
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(created);

    await expect(service.register(OWNER, { path: '/work/wt' })).resolves.toBe(
      created,
    );

    expect(data.findCheckoutByPath).toHaveBeenCalledTimes(3);
    expect(data.createCheckout).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ parentCheckoutId: PARENT_ID }),
    );
  });

  it('answers 404 when no parent can be read', async () => {
    const { service } = worktreeService();
    data.createCheckout.mockResolvedValue(undefined);

    await expect(
      failureOf(service.register(OWNER, { path: '/work/wt' })),
    ).resolves.toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Repository record not found',
      code: 'not_found',
    });
    // Only the parent insert was attempted; the worktree never is.
    expect(data.createCheckout).toHaveBeenCalledTimes(1);
  });

  it('refuses a main clone of another repository', async () => {
    const { service } = worktreeService();
    // A selector names the repository; the recorded main clone of the worktree
    // belongs to a different one, so the pair would be broken.
    data.findRepository.mockResolvedValue(repository);
    data.findCheckoutByPath.mockResolvedValue(
      checkoutRow({
        id: PARENT_ID,
        path: '/work/proj',
        repositoryId: OTHER_REPOSITORY_ID,
      }),
    );

    await expect(
      failureOf(
        service.register(OWNER, {
          path: '/work/wt',
          repositoryId: REPOSITORY_ID,
        }),
      ),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message:
        'The main clone of this worktree belongs to another repository, or is recorded as a worktree.',
      code: 'invalid_path',
    });
    expect(data.createCheckout).not.toHaveBeenCalled();
  });

  it('refuses a main clone recorded as a worktree', async () => {
    const { service } = worktreeService();
    data.findCheckoutByPath.mockResolvedValue(
      checkoutRow({
        id: PARENT_ID,
        path: '/work/proj',
        kind: 'worktree',
        parentCheckoutId: CHILD_ID,
      }),
    );
    data.findRepository.mockResolvedValue(repository);

    await expect(
      failureOf(service.register(OWNER, { path: '/work/wt' })),
    ).resolves.toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message:
        'The main clone of this worktree belongs to another repository, or is recorded as a worktree.',
      code: 'invalid_path',
    });
    expect(data.createCheckout).not.toHaveBeenCalled();
  });
});
