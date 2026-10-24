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
import { type PermissionGroup } from '../tools/permissions/types';
import {
  CheckoutRegistrationService,
  type GitInspector,
} from './checkout-registration.service';

const ALLOWED_LOCAL: Partial<LlameConfig['tools']> = {
  nativeExecutorId: 'test-host',
  allowed: ['enter_workspace'],
};

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
    {
      config: {
        ...BUILT_IN_DEFAULTS,
        tools: {
          ...BUILT_IN_DEFAULTS.tools,
          ...(options.tools ?? ALLOWED_LOCAL),
        },
      },
    },
    { inspect },
    compileToolPermissionMap(
      { enter_workspace: options.group ?? { allow: true } },
      'test-policy',
    ),
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

/**
 * The gate order, which no HTTP suite can prove: a refusal that comes before
 * the probe answers 403 even though the path does not exist.
 */
describe('CheckoutRegistrationService gates', () => {
  it('refuses a relative path as invalid input', async () => {
    const { service } = makeService({});

    await expect(
      failureOf(service.register('owner-a', { path: 'srv/app' })),
    ).resolves.toMatchObject({ statusCode: 422, code: 'invalid_path' });
  });

  it('decides the submitted path before probing it', async () => {
    const { service, inspect } = makeService({
      group: { reject: true, allow: true },
    });

    // The path does not exist: a probe would answer 422, so a 403 proves the
    // decision came first.
    await expect(
      failureOf(service.register('owner-a', { path: '/no/such/checkout' })),
    ).resolves.toMatchObject({ statusCode: 403, code: 'permission_denied' });
    expect(inspect).not.toHaveBeenCalled();
  });
});
