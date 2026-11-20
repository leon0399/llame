/**
 * Integration tests for `projects://` discovery against real Postgres.
 *
 * The datastore is real and owner-scoped through `TenantDbService.runAs`, so
 * these prove the parts a doubled datastore cannot: forced RLS plus the
 * repository owner filters isolate owners, a foreign and a missing UUID take
 * the same path, a Project detail joins only its own linked repositories and
 * the owner's checkouts (including both kinds and a `machine://` locator),
 * datastore failures surface instead of an empty page, and no executor or
 * Machine identity is needed or contacted.
 *
 * The read is driven through the real native `read` tool, so scheme dispatch
 * and the reader wiring are covered as shipped. The checkout paths do not
 * exist on this host: the detail still returns them verbatim, which is itself
 * evidence that discovery probes nothing.
 *
 * Requires TEST_DATABASE_URL; run by test:integration.
 */

import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { isNumber, isString } from '@workspace/runtime-safety';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import {
  checkouts,
  projectRepositories,
  projects,
  repositories,
} from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import {
  nativeEditTool,
  nativeReadTool,
  nativeWriteTool,
} from '../tools/native-files';
import { type ToolContext, type ToolResult } from '../tools/types';

vi.setConfig({ testTimeout: 60_000 });

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'project-reader.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

const INSTRUCTIONS = 'Run the focused tests before every commit.';
const UPDATED_INSTRUCTIONS = 'Ask before rewriting shared files.';
const BULK_PROJECTS = 120;

type Fixture = { readonly id: string };

type Harness = {
  readonly alpha: Fixture;
  readonly archived: Fixture;
  readonly documented: Fixture;
  readonly otherProject: Fixture;
  readonly mainCheckout: Fixture;
  readonly worktreeCheckout: Fixture;
  readonly machineCheckout: Fixture;
  readonly missingHostPath: string;
};

let sqlClient: Sql;
let tenantDb: TenantDbService;
let owner: string;
let otherOwner: string;
let bulkOwner: string;
let harness: Harness;

function contextFor(userId: string): ToolContext {
  // No Run, attempt, native executor, Workspace, Machine, or SSH client: a
  // Project read must work from the owner identity alone.
  return {
    userId,
    chatId: randomUUID(),
    tenantDb,
    configuredCredentials: [],
  };
}

async function readResource(userId: string, path: string): Promise<ToolResult> {
  return nativeReadTool.execute(contextFor(userId), { path });
}

function contentOf(result: ToolResult): string {
  const content = successOf(result)['content'];

  if (!isString(content)) throw new Error('expected a successful text read');

  return content;
}

/** The success half of a result, with its own status narrowed. */
function successOf(
  result: ToolResult,
): Extract<ToolResult, { status: 'success' }> {
  if (result.status !== 'success') throw new Error('expected a success');

  return result;
}

function errorTypeOf(result: ToolResult): string {
  if (result.status !== 'error') throw new Error('expected an error result');

  return result.type;
}

function nextOffsetOf(result: ToolResult): number | undefined {
  const offset = successOf(result)['nextOffset'];

  return isNumber(offset) ? offset : undefined;
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) throw new Error(`Could not seed ${label}`);

  return row;
}

async function seedUser(id: string, label: string): Promise<void> {
  await sqlClient`INSERT INTO users (id, name, email) VALUES (${id}, ${label}, ${`reader-${id}@test.com`})`;
}

async function seedProject(
  ownerUserId: string,
  values: {
    readonly name: string;
    readonly description?: string | null;
    readonly instructions?: string | null;
    readonly archived?: boolean;
  },
): Promise<Fixture> {
  return tenantDb.runAs(ownerUserId, async (tx) => {
    const row = requireRow(
      (
        await tx
          .insert(projects)
          .values({
            ownerUserId,
            name: values.name,
            description: values.description ?? null,
            instructions: values.instructions ?? null,
            archivedAt: values.archived === true ? new Date() : null,
          })
          .returning()
      )[0],
      values.name,
    );

    return { id: row.id };
  });
}

async function seedRepository(input: {
  readonly ownerUserId: string;
  readonly displayName: string;
  readonly canonicalRemote: string | null;
}): Promise<Fixture> {
  return tenantDb.runAs(input.ownerUserId, async (tx) => {
    const row = requireRow(
      (
        await tx
          .insert(repositories)
          .values({
            ownerUserId: input.ownerUserId,
            displayName: input.displayName,
            canonicalRemote: input.canonicalRemote,
          })
          .returning()
      )[0],
      input.displayName,
    );

    return { id: row.id };
  });
}

async function seedLink(input: {
  readonly ownerUserId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly alias: string;
  readonly isPrimary: boolean;
}): Promise<void> {
  await tenantDb.runAs(input.ownerUserId, async (tx) => {
    await tx.insert(projectRepositories).values({
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      repositoryId: input.repositoryId,
      alias: input.alias,
      isPrimary: input.isPrimary,
    });
  });
}

async function seedCheckout(input: {
  readonly ownerUserId: string;
  readonly repositoryId: string;
  readonly executorId: string;
  readonly path: string;
  readonly kind: 'main' | 'worktree';
  readonly parentCheckoutId?: string;
  readonly origin: 'registered' | 'created';
}): Promise<Fixture> {
  return tenantDb.runAs(input.ownerUserId, async (tx) => {
    const row = requireRow(
      (
        await tx
          .insert(checkouts)
          .values({
            ownerUserId: input.ownerUserId,
            repositoryId: input.repositoryId,
            executorId: input.executorId,
            path: input.path,
            kind: input.kind,
            parentCheckoutId: input.parentCheckoutId ?? null,
            branch: null,
            origin: input.origin,
            worktreeBase: null,
          })
          .returning()
      )[0],
      input.path,
    );

    return { id: row.id };
  });
}

async function seedBulkProjects(ownerUserId: string): Promise<void> {
  const rows = Array.from({ length: BULK_PROJECTS }, (_unused, index) => {
    const number = String(index + 1).padStart(3, '0');

    return {
      ownerUserId,
      name: `Bulk ${number}`,
      description: `Bulk discovery project number ${number} for paging.`,
      instructions: null,
      archivedAt: null,
    };
  });

  await tenantDb.runAs(ownerUserId, async (tx) => {
    await tx.insert(projects).values(rows);
  });
}

beforeAll(async () => {
  const ssl = /sslmode=require/.test(TEST_DB_URL) ? 'require' : false;

  sqlClient = postgres(TEST_DB_URL, { ssl, max: 3 });
  tenantDb = new TenantDbService(drizzle({ client: sqlClient }));
  owner = randomUUID();
  otherOwner = randomUUID();
  bulkOwner = randomUUID();

  await seedUser(owner, 'Reader');
  await seedUser(otherOwner, 'Other');
  await seedUser(bulkOwner, 'Bulk');

  const alpha = await seedProject(owner, {
    name: 'Alpha API',
    description: 'Remote control plane',
    instructions: INSTRUCTIONS,
  });

  await seedProject(owner, {
    name: 'Beta Web',
    description: null,
    instructions: null,
  });

  const archived = await seedProject(owner, {
    name: 'Archived Notes',
    instructions: 'Old archived guidance.',
    archived: true,
  });

  const documented = await seedProject(owner, {
    name: 'Documented Service',
    description: 'Current values read back here',
    instructions: 'Initial guidance.',
  });

  const otherProject = await seedProject(otherOwner, {
    name: 'Other Private Project',
    instructions: 'Never disclose this.',
  });

  const apiRepository = await seedRepository({
    ownerUserId: owner,
    displayName: 'api',
    canonicalRemote: 'github.com/acme/api',
  });

  const docsRepository = await seedRepository({
    ownerUserId: owner,
    displayName: 'docs-site',
    canonicalRemote: null,
  });

  const unlinkedRepository = await seedRepository({
    ownerUserId: owner,
    displayName: 'unlinked',
    canonicalRemote: 'github.com/acme/unlinked',
  });

  const foreignRepository = await seedRepository({
    ownerUserId: otherOwner,
    displayName: 'foreign-api',
    canonicalRemote: 'github.com/acme/api',
  });

  await seedLink({
    ownerUserId: owner,
    projectId: alpha.id,
    repositoryId: apiRepository.id,
    alias: 'web-api',
    isPrimary: true,
  });
  await seedLink({
    ownerUserId: owner,
    projectId: alpha.id,
    repositoryId: docsRepository.id,
    alias: 'core-docs',
    isPrimary: false,
  });
  await seedLink({
    ownerUserId: owner,
    projectId: archived.id,
    repositoryId: apiRepository.id,
    alias: 'archive-api',
    isPrimary: true,
  });
  await seedLink({
    ownerUserId: otherOwner,
    projectId: otherProject.id,
    repositoryId: foreignRepository.id,
    alias: 'foreign-api',
    isPrimary: true,
  });

  const missingHostPath = `/nonexistent-project-discovery-${randomUUID()}/api`;

  const mainCheckout = await seedCheckout({
    ownerUserId: owner,
    repositoryId: apiRepository.id,
    executorId: 'host-a',
    path: missingHostPath,
    kind: 'main',
    origin: 'registered',
  });

  const worktreeCheckout = await seedCheckout({
    ownerUserId: owner,
    repositoryId: apiRepository.id,
    executorId: 'host-b',
    path: `${missingHostPath}-wt`,
    kind: 'worktree',
    parentCheckoutId: mainCheckout.id,
    origin: 'created',
  });

  const machineCheckout = await seedCheckout({
    ownerUserId: owner,
    repositoryId: apiRepository.id,
    executorId: 'machine:nas',
    path: 'machine://nas/srv/api',
    kind: 'main',
    origin: 'registered',
  });

  await seedCheckout({
    ownerUserId: owner,
    repositoryId: unlinkedRepository.id,
    executorId: 'host-a',
    path: '/work/unlinked',
    kind: 'main',
    origin: 'registered',
  });
  await seedCheckout({
    ownerUserId: otherOwner,
    repositoryId: foreignRepository.id,
    executorId: 'host-a',
    path: '/other/work/api',
    kind: 'main',
    origin: 'registered',
  });

  await seedBulkProjects(bulkOwner);

  harness = {
    alpha,
    archived,
    documented,
    otherProject,
    mainCheckout,
    worktreeCheckout,
    machineCheckout,
    missingHostPath,
  };
});

afterAll(async () => {
  if (!sqlClient) return;

  await sqlClient`DELETE FROM users WHERE id IN (${owner}, ${otherOwner}, ${bulkOwner})`;
  await sqlClient.end();
});

describe('projects:// listings', () => {
  it('lists only the owner active Projects with detail locators', async () => {
    const result = await readResource(owner, 'projects://');

    expect(result.status).toBe('success');

    const content = contentOf(result);

    expect(content).toContain(JSON.stringify('Alpha API'));
    expect(content).toContain(JSON.stringify('Beta Web'));
    expect(content).toContain(JSON.stringify(harness.alpha.id));
    expect(content).toContain(`projects://${harness.alpha.id}`);
    expect(content).not.toContain(JSON.stringify('Archived Notes'));
    expect(content).not.toContain(JSON.stringify('Other Private Project'));
    // Listings never carry owner guidance.
    expect(content).not.toContain(JSON.stringify(INSTRUCTIONS));
  });

  it('lists only archived Projects for the archived locator', async () => {
    const content = contentOf(await readResource(owner, 'projects://archived'));

    expect(content).toContain(JSON.stringify('Archived Notes'));
    expect(content).toContain(JSON.stringify(harness.archived.id));
    expect(content).not.toContain(JSON.stringify('Alpha API'));
    expect(content).not.toContain(JSON.stringify('Beta Web'));
  });

  it('treats the root alias as the active listing', async () => {
    const direct = await readResource(owner, 'projects://');
    const alias = await readResource(owner, 'PROJECTS:///');

    expect(alias).toEqual(direct);
  });

  it('normalizes an uppercase scheme and UUID to one canonical read', async () => {
    const plain = await readResource(
      owner,
      `projects://${harness.documented.id}`,
    );

    const loud = await readResource(
      owner,
      `PROJECTS://${harness.documented.id.toUpperCase()}`,
    );

    expect(successOf(loud)['path']).toBe(`projects://${harness.documented.id}`);
    expect(loud).toEqual(plain);
  });
});

describe('projects:// detail', () => {
  it('returns current stored values and literal instructions', async () => {
    const content = contentOf(
      await readResource(owner, `projects://${harness.documented.id}`),
    );

    expect(content).toContain(JSON.stringify(harness.documented.id));
    expect(content).toContain(JSON.stringify('Documented Service'));
    expect(content).toContain(JSON.stringify('Current values read back here'));
    expect(content).toContain(JSON.stringify('Initial guidance.'));
  });

  it('returns the newly stored instructions after an owner edit', async () => {
    await tenantDb.runAs(owner, async (tx) => {
      await tx
        .update(projects)
        .set({ instructions: UPDATED_INSTRUCTIONS, updatedAt: new Date() })
        .where(eq(projects.id, harness.documented.id));
    });

    const content = contentOf(
      await readResource(owner, `projects://${harness.documented.id}`),
    );

    expect(content).toContain(JSON.stringify(UPDATED_INSTRUCTIONS));
    expect(content).not.toContain(JSON.stringify('Initial guidance.'));
  });

  it('returns an archived Project individually', async () => {
    const content = contentOf(
      await readResource(owner, `projects://${harness.archived.id}`),
    );

    expect(content).toContain(JSON.stringify('Archived Notes'));
    expect(content).toContain(JSON.stringify('Old archived guidance.'));
  });

  it('answers another owner Project exactly as a missing one', async () => {
    const foreign = await readResource(
      owner,
      `projects://${harness.otherProject.id}`,
    );

    const missing = await readResource(owner, `projects://${randomUUID()}`);

    expect(errorTypeOf(foreign)).toBe('not_found');
    expect(foreign).toEqual(missing);
    expect(JSON.stringify(foreign)).not.toContain('Other Private Project');
  });

  it('discloses only linked owner repositories and their checkouts', async () => {
    const content = contentOf(
      await readResource(owner, `projects://${harness.alpha.id}`),
    );

    // Linked repositories, including one with neither a remote nor a checkout.
    expect(content).toContain(JSON.stringify('web-api'));
    expect(content).toContain(JSON.stringify('core-docs'));
    expect(content).toContain(JSON.stringify('docs-site'));
    expect(content).toContain(JSON.stringify('github.com/acme/api'));

    // Every owner checkout of the linked repository, kind and authority kept.
    expect(content).toContain(JSON.stringify(harness.missingHostPath));
    expect(content).toContain(JSON.stringify(`${harness.missingHostPath}-wt`));
    expect(content).toContain(JSON.stringify('machine://nas/srv/api'));
    expect(content).toContain(JSON.stringify('host-a'));
    expect(content).toContain(JSON.stringify('host-b'));
    expect(content).toContain(JSON.stringify('machine:nas'));
    expect(content).toContain(JSON.stringify('worktree'));
    expect(content).toContain(JSON.stringify(harness.mainCheckout.id));
    expect(content).toContain(JSON.stringify(harness.worktreeCheckout.id));
    expect(content).toContain(JSON.stringify(harness.machineCheckout.id));

    // An unlinked repository of the same owner, and another owner's checkout
    // of the same remote, are not part of this Project.
    expect(content).not.toContain(JSON.stringify('/work/unlinked'));
    expect(content).not.toContain(JSON.stringify('/other/work/api'));
    expect(content).not.toContain(JSON.stringify('foreign-api'));
  });

  it('reads registered locations without probing or contacting them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await readResource(owner, `projects://${harness.alpha.id}`);

    const content = contentOf(result);

    // The local checkout path does not exist on this host; the stored locator
    // is still returned, and the Machine locator is text, never a contact.
    expect(existsSync(harness.missingHostPath)).toBe(false);
    expect(content).toContain(JSON.stringify(harness.missingHostPath));
    expect(content).toContain(JSON.stringify('machine://nas/srv/api'));
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('keeps a detail outline to generated headings', async () => {
    const outline = await readResource(
      owner,
      `projects://${harness.alpha.id}:outline`,
    );

    expect(successOf(outline)['representation']).toBe('outline');
    expect(contentOf(outline)).not.toContain(JSON.stringify(INSTRUCTIONS));
    expect(contentOf(outline)).not.toContain(JSON.stringify('host-a'));
  });
});

describe('projects:// paging and selector representations', () => {
  it('pages a large listing until every Project is reachable', async () => {
    const combined: Array<string> = [];
    let path = 'projects://';
    let previousOffset = 0;
    let pages = 0;

    for (;;) {
      const result = await readResource(bulkOwner, path);

      combined.push(contentOf(result));
      pages += 1;
      expect(pages).toBeLessThan(BULK_PROJECTS * 2);

      if (successOf(result)['truncated'] !== true) break;

      const next = nextOffsetOf(result);

      if (next === undefined)
        throw new Error('a truncated read must give a next offset');
      // The cap notice names a progressing selector for the same resource;
      // `nextOffset` is a zero-based index, so the selector starts one later.
      expect(next).toBeGreaterThan(previousOffset);
      previousOffset = next;
      path = `projects://:${next + 1}-`;
    }

    const joined = combined.join('\n');

    for (let index = 1; index <= BULK_PROJECTS; index += 1) {
      expect(joined).toContain(
        JSON.stringify(`Bulk ${String(index).padStart(3, '0')}`),
      );
    }
  });

  it('applies raw and multiple ranges to a listing', async () => {
    const raw = await readResource(owner, 'projects://:raw');
    const ranged = await readResource(owner, 'projects://:1-1,2-2');

    expect(successOf(raw)['representation']).toBe('raw');
    expect(contentOf(raw)).toContain(JSON.stringify('Alpha API'));
    expect(ranged.status).toBe('success');
    expect(Array.isArray(successOf(ranged)['shownRanges'])).toBe(true);
  });

  it('returns a native refusal for an invalid selector', async () => {
    const result = await readResource(owner, 'projects://:5-2');

    expect(errorTypeOf(result)).toBe('invalid_selector');
  });

  it('refuses a malformed selector before opening a tenant transaction', async () => {
    const runAs = vi.spyOn(tenantDb, 'runAs');

    try {
      const existing = await readResource(
        owner,
        `projects://${harness.documented.id}:nonsense`,
      );

      const missing = await readResource(
        owner,
        `projects://${randomUUID()}:nonsense`,
      );

      const loud = await readResource(
        owner,
        `PROJECTS://${harness.documented.id.toUpperCase()}:nonsense`,
      );

      // Both the stored and the absent UUID are refused for the suffix alone:
      // the real database is never asked whether the Project exists.
      expect(errorTypeOf(existing)).toBe('invalid_selector');
      expect(loud).toEqual(existing);
      expect(existing).toEqual(missing);
      expect(runAs).not.toHaveBeenCalled();
    } finally {
      runAs.mockRestore();
    }
  });
});

describe('projects:// authority boundaries', () => {
  it('refuses edit and write without changing stored values', async () => {
    const path = `projects://${harness.documented.id}`;
    const before = await readResource(owner, path);

    const edited = await nativeEditTool.execute(contextFor(owner), {
      path,
      oldText: UPDATED_INSTRUCTIONS,
      newText: 'Replaced without admission.',
    });

    const written = await nativeWriteTool.execute(contextFor(owner), {
      path,
      content: 'Replaced without admission.',
      replace: true,
    });

    expect(errorTypeOf(edited)).toBe('unsupported_operation');
    expect(errorTypeOf(written)).toBe('unsupported_operation');

    const after = await readResource(owner, path);

    expect(after).toEqual(before);
  });

  it('fails closed without an owner identity', async () => {
    await expect(
      nativeReadTool.execute(contextFor(''), { path: 'projects://' }),
    ).rejects.toThrow(/non-empty userId/u);
  });

  it('reads without any executor identity or Workspace', async () => {
    const context = contextFor(owner);

    expect(context.nativeExecutorId).toBeUndefined();
    expect(context.workspaceRoot).toBeUndefined();

    const result = await readResource(owner, 'projects://');

    expect(result.status).toBe('success');
  });
});
