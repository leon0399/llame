import { HttpException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import { z } from 'zod';

import * as schema from '../db/schema';
import { type GitInspectResult } from '@workspace/git-executor';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  type LlameConfig,
  BUILT_IN_DEFAULTS,
} from '../instance-config/llame-config';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import {
  type CompiledPolicy,
  type PermissionGroup,
} from '../tools/permissions/types';
import { CheckoutRegistrationService } from './checkout-registration.service';
import { type GitInspector } from './git-inspector';
import { RepositoriesRepository } from './repositories.repository';

/**
 * The gate order of a registration, without a database or a real git: an
 * executor, the allowlist, and the submitted-path decision must each answer
 * before anything is probed, inspected, or written.
 */

function configWith(tools: Partial<LlameConfig['tools']>) {
  return {
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: { ...BUILT_IN_DEFAULTS.tools, ...tools },
    },
  };
}

const ALLOWED_LOCAL: Partial<LlameConfig['tools']> = {
  nativeExecutorId: 'test-host',
  allowed: ['enter_workspace'],
};

function compiled(group: PermissionGroup): CompiledPolicy {
  return compileToolPermissionMap({ enter_workspace: group }, 'test-policy');
}

const inspectedRepository: GitInspectResult = {
  status: 'ok',
  toplevel: '/srv',
  commonDir: '/srv/.git',
  linked: false,
  mainWorktree: null,
  remotes: [{ name: 'origin', url: 'git@github.com:leon0399/llame.git' }],
  branch: 'main',
  head: 'a'.repeat(40),
};

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
    .fn<GitInspector['inspect']>()
    .mockResolvedValue(options.inspection ?? inspectedRepository);
  const service = new CheckoutRegistrationService(
    tenantDb,
    configWith(options.tools ?? ALLOWED_LOCAL),
    { inspect },
    compiled(options.group ?? { allow: true }),
  );
  return { service, inspect };
}

const failureSchema = z.object({
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
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
  vi.restoreAllMocks();
});

describe('CheckoutRegistrationService gates', () => {
  it('refuses a local path on a process without a native executor', async () => {
    const { service, inspect } = makeService({
      tools: { nativeExecutorId: undefined },
    });

    await expect(
      failureOf(service.register('owner-a', { path: '/srv/app' })),
    ).resolves.toMatchObject({
      statusCode: 503,
      code: 'executor_unavailable',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('refuses a machine:// path as unavailable in this layer', async () => {
    const { service, inspect } = makeService({});

    await expect(
      failureOf(service.register('owner-a', { path: 'machine://nas/srv/app' })),
    ).resolves.toMatchObject({
      statusCode: 503,
      code: 'executor_unavailable',
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('refuses a relative path as invalid input', async () => {
    const { service } = makeService({});

    await expect(
      failureOf(service.register('owner-a', { path: 'srv/app' })),
    ).resolves.toMatchObject({ statusCode: 422, code: 'invalid_path' });
  });

  it('refuses a missing allowlist entry before any inspection', async () => {
    const { service, inspect } = makeService({
      tools: { ...ALLOWED_LOCAL, allowed: [] },
    });

    await expect(
      failureOf(service.register('owner-a', { path: '/srv/app' })),
    ).resolves.toMatchObject({ statusCode: 403, code: 'tool_not_allowed' });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('decides the submitted path before probing it', async () => {
    const { service, inspect } = makeService({
      group: { reject: true, allow: true },
    });

    // The path does not exist: a probe would answer 404, so a 403 proves the
    // decision came first.
    await expect(
      failureOf(service.register('owner-a', { path: '/no/such/checkout' })),
    ).resolves.toMatchObject({ statusCode: 403, code: 'permission_denied' });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('refuses a path that no allow covers', async () => {
    const { service } = makeService({
      group: { allow: [{ field: 'path', regex: '^/home/dev/' }] },
    });

    await expect(
      failureOf(service.register('owner-a', { path: '/tmp/checkout' })),
    ).resolves.toMatchObject({ statusCode: 403, code: 'permission_denied' });
  });
});

describe('CheckoutRegistrationService inspection mapping', () => {
  it('answers a path without a repository as 422 not_a_repository', async () => {
    const { service } = makeService({
      inspection: {
        status: 'error',
        type: 'not_a_repository',
        stderr: 'fatal: not a git repository',
      },
    });

    await expect(
      failureOf(service.register('owner-a', { path: '/tmp' })),
    ).resolves.toMatchObject({ statusCode: 422, code: 'not_a_repository' });
  });

  it('answers a timeout as 502 git_failed', async () => {
    const { service } = makeService({
      inspection: {
        status: 'error',
        type: 'timed_out',
        stderr: 'git did not finish',
      },
    });

    await expect(
      failureOf(service.register('owner-a', { path: '/tmp' })),
    ).resolves.toMatchObject({ statusCode: 502, code: 'git_failed' });
  });

  it('answers another git failure as 502 with its standard error', async () => {
    const { service } = makeService({
      inspection: {
        status: 'error',
        type: 'git_failed',
        stderr: 'fatal: bad object HEAD',
      },
    });

    const failure = await failureOf(
      service.register('owner-a', { path: '/tmp' }),
    );
    expect(failure).toMatchObject({ statusCode: 502, code: 'git_failed' });
    expect(failure.message).toContain('fatal: bad object HEAD');
  });

  it('answers an origin mismatch as 422 and stores nothing', async () => {
    const { service } = makeService({});
    const createCheckout = vi.spyOn(
      RepositoriesRepository.prototype,
      'createCheckout',
    );
    vi.spyOn(
      RepositoriesRepository.prototype,
      'findRepository',
    ).mockResolvedValue({
      id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
      ownerUserId: 'owner-a',
      displayName: 'other',
      canonicalRemote: 'github.com/leon0399/other',
      createdAt: new Date('2026-10-24T00:00:00.000Z'),
      updatedAt: new Date('2026-10-24T00:00:00.000Z'),
    });
    vi.spyOn(RepositoriesRepository.prototype, 'listAliases').mockResolvedValue(
      [],
    );

    await expect(
      failureOf(
        service.register('owner-a', {
          path: '/tmp',
          repositoryId: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
        }),
      ),
    ).resolves.toMatchObject({ statusCode: 422, code: 'origin_mismatch' });
    expect(createCheckout).not.toHaveBeenCalled();
  });
});
