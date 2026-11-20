/**
 * Unit tests for the `projects://` reader (project-discovery D5-D7).
 *
 * The datastore and the repository read model are doubled, so these prove the
 * reader's own decisions: mutation refusal and locator parsing happen before a
 * datastore access, one owner transaction serves an admitted read, active and
 * archived listings take distinct repository filters, a foreign or missing
 * Project collapses to one answer, datastore failure is not empty success, the
 * abort signal is honoured, and native text selectors apply to the rendered
 * document. The real parser and renderer run, so the document stays the
 * renderer's contract rather than a copied format.
 */

import { isString } from '@workspace/runtime-safety';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type Project } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { readAcceptsScheme, readLocatorSchemes } from '../tools/native-files';
import { type ToolContext, type ToolResult } from '../tools/types';
import { type ProjectRepositoryView } from './project-document';
import { ProjectDiscoveryRepository } from './project-discovery.repository';
import { readProjectResource } from './project-reader';
import { ProjectsRepository } from './projects-repository';

const OWNER = 'owner-1';
const PROJECT_ID = '0f8e2c1a-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const OTHER_PROJECT_ID = '9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d';
const MISSING_PROJECT_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const INSTRUCTIONS = 'Always run the focused tests first.';

function projectRow(overrides: Partial<Project> = {}): Project {
  const now = new Date('2026-11-20T00:00:00.000Z');

  return {
    id: PROJECT_ID,
    ownerUserId: OWNER,
    name: 'Alpha project',
    description: 'Handles the API',
    instructions: INSTRUCTIONS,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    defaultExecutorId: null,
    ...overrides,
  };
}

function repositoryView(
  overrides: Partial<ProjectRepositoryView> = {},
): ProjectRepositoryView {
  return {
    id: '7b7e2b6a-0f2c-4b9a-8a6e-3e7c2b1d0f4a',
    alias: 'api',
    displayName: 'api',
    canonicalRemote: 'github.com/acme/api',
    isPrimary: true,
    checkouts: [
      {
        id: '5d8e4f2a-1c3b-4d5e-9f70-a1b2c3d4e5f6',
        kind: 'main',
        parentCheckoutId: null,
        executorId: 'host-a',
        locator: '/work/api',
      },
    ],
    ...overrides,
  };
}

/** A tenant double that hands the reader a mock transaction handle and counts
 *  how often it was asked for one. */
function fakeContext(options: { readonly abortSignal?: AbortSignal } = {}) {
  const db: Db = drizzle.mock();
  let reads = 0;

  const tenantDb: TenantRunner = {
    runAs: <T>(_userId: string, work: (tx: Db) => Promise<T>): Promise<T> => {
      reads += 1;

      return work(db);
    },
  };

  return {
    context: {
      userId: OWNER,
      chatId: 'chat-1',
      tenantDb,
      configuredCredentials: [],
      abortSignal: options.abortSignal,
    } satisfies ToolContext,
    reads: () => reads,
  };
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readProjectResource refusal before the datastore', () => {
  it.each(['edit', 'write'] as const)(
    'refuses %s with unsupported_operation and no read',
    async (operation) => {
      const { context, reads } = fakeContext();

      const result = await readProjectResource(
        context,
        operation,
        `projects://${PROJECT_ID}`,
      );

      expect(errorTypeOf(result)).toBe('unsupported_operation');
      expect(reads()).toBe(0);
    },
  );

  it.each([
    'projects://name',
    'projects://id/other',
    'projects://?query=1',
    'projects://#fragment',
    'projects://%41',
    'projects://not-a-uuid',
    'projects://not-a-uuid:nonsense',
    'projects://archived/extra',
  ])('refuses %s as invalid_path before the datastore', async (submitted) => {
    const { context, reads } = fakeContext();

    const result = await readProjectResource(context, 'read', submitted);

    expect(errorTypeOf(result)).toBe('invalid_path');
    expect(reads()).toBe(0);
  });

  it.each([
    `projects://${PROJECT_ID}:nonsense`,
    `projects://${PROJECT_ID.toUpperCase()}:nonsense`,
    `projects://${MISSING_PROJECT_ID}:nonsense`,
    `projects://${PROJECT_ID}:raw:abc`,
    'projects://:',
    'projects://:nonsense',
    'projects://archived:nonsense',
    'projects://:outline:1,3',
  ])(
    'refuses the malformed selector in %s before the datastore',
    async (submitted) => {
      const find = vi.spyOn(ProjectsRepository.prototype, 'findById');

      const list = vi.spyOn(
        ProjectDiscoveryRepository.prototype,
        'listProjects',
      );

      const { context, reads } = fakeContext();

      const result = await readProjectResource(context, 'read', submitted);

      // The suffix is the native reader's grammar, so its refusal is the
      // selector's own: a missing Project cannot turn it into not_found.
      expect(errorTypeOf(result)).toBe('invalid_selector');
      expect(reads()).toBe(0);
      expect(find).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    },
  );

  it('answers a valid selector on a missing Project as not_found', async () => {
    const find = vi
      .spyOn(ProjectsRepository.prototype, 'findById')
      .mockResolvedValue(undefined);

    const { context, reads } = fakeContext();

    const result = await readProjectResource(
      context,
      'read',
      `projects://${MISSING_PROJECT_ID}:1-2`,
    );

    expect(find).toHaveBeenCalledWith(MISSING_PROJECT_ID, OWNER);
    expect(errorTypeOf(result)).toBe('not_found');
    expect(reads()).toBe(1);
  });

  it('shares one native scheme-acceptance entry with prompt imports', () => {
    expect(readAcceptsScheme('projects')).toBe(true);
    expect(readLocatorSchemes()).toContain('projects');
  });
});

describe('readProjectResource active and archived listings', () => {
  it('lists active Projects through the discovery metadata query', async () => {
    const list = vi
      .spyOn(ProjectDiscoveryRepository.prototype, 'listProjects')
      .mockResolvedValue([
        projectRow(),
        projectRow({ id: OTHER_PROJECT_ID, name: 'Beta project' }),
      ]);

    const discover = vi.spyOn(
      ProjectDiscoveryRepository.prototype,
      'listForProject',
    );

    const legacy = vi.spyOn(ProjectsRepository.prototype, 'listForUser');

    const { context, reads } = fakeContext();

    const result = await readProjectResource(context, 'read', 'projects://');

    expect(reads()).toBe(1);
    expect(list).toHaveBeenCalledWith(OWNER, false);
    expect(discover).not.toHaveBeenCalled();
    // A listing never loads full Project rows, so instructions never cross
    // the datastore boundary for metadata.
    expect(legacy).not.toHaveBeenCalled();

    const content = contentOf(result);

    expect(content).toContain(JSON.stringify('Alpha project'));
    expect(content).toContain(JSON.stringify('Beta project'));
    expect(content).toContain(JSON.stringify(PROJECT_ID));
    // A listing carries discovery metadata only, never owner guidance.
    expect(content).not.toContain(JSON.stringify(INSTRUCTIONS));
  });

  it('lists archived Projects through the archived metadata query', async () => {
    const list = vi
      .spyOn(ProjectDiscoveryRepository.prototype, 'listProjects')
      .mockResolvedValue([
        projectRow({ name: 'Archived project', archivedAt: new Date() }),
      ]);

    const legacy = vi.spyOn(ProjectsRepository.prototype, 'listForUser');

    const { context } = fakeContext();

    const result = await readProjectResource(
      context,
      'read',
      'projects://archived',
    );

    expect(list).toHaveBeenCalledWith(OWNER, true);
    expect(legacy).not.toHaveBeenCalled();
    expect(contentOf(result)).toContain(JSON.stringify('Archived project'));
  });
});

describe('readProjectResource detail', () => {
  it('returns current Project values and only linked owner locations', async () => {
    const find = vi
      .spyOn(ProjectsRepository.prototype, 'findById')
      .mockResolvedValue(projectRow());

    const discover = vi
      .spyOn(ProjectDiscoveryRepository.prototype, 'listForProject')
      .mockResolvedValue([repositoryView()]);

    const { context, reads } = fakeContext();

    const result = await readProjectResource(
      context,
      'read',
      `projects://${PROJECT_ID}`,
    );

    expect(reads()).toBe(1);
    expect(find).toHaveBeenCalledWith(PROJECT_ID, OWNER);
    expect(discover).toHaveBeenCalledWith(OWNER, PROJECT_ID);
    expect(successOf(result)['path']).toBe(`projects://${PROJECT_ID}`);

    const content = contentOf(result);

    expect(content).toContain(JSON.stringify(PROJECT_ID));
    expect(content).toContain(JSON.stringify('Alpha project'));
    expect(content).toContain(JSON.stringify('Handles the API'));
    expect(content).toContain(JSON.stringify(INSTRUCTIONS));
    expect(content).toContain(JSON.stringify('api'));
    expect(content).toContain(JSON.stringify('github.com/acme/api'));
    expect(content).toContain(JSON.stringify('/work/api'));
    expect(content).toContain(JSON.stringify('host-a'));
  });

  it('answers a foreign Project exactly as a missing Project', async () => {
    vi.spyOn(ProjectsRepository.prototype, 'findById').mockResolvedValue(
      undefined,
    );

    const discover = vi.spyOn(
      ProjectDiscoveryRepository.prototype,
      'listForProject',
    );

    const { context } = fakeContext();

    const foreign = await readProjectResource(
      context,
      'read',
      `projects://${OTHER_PROJECT_ID}`,
    );

    const missing = await readProjectResource(
      context,
      'read',
      `projects://${MISSING_PROJECT_ID}`,
    );

    expect(errorTypeOf(foreign)).toBe('not_found');
    expect(foreign).toEqual(missing);
    expect(discover).not.toHaveBeenCalled();
  });
});

describe('readProjectResource failure handling', () => {
  it('propagates a datastore failure instead of an empty success', async () => {
    vi.spyOn(
      ProjectDiscoveryRepository.prototype,
      'listProjects',
    ).mockRejectedValue(new Error('connection reset'));
    const { context } = fakeContext();

    await expect(
      readProjectResource(context, 'read', 'projects://'),
    ).rejects.toThrow('connection reset');
  });

  it('honours an aborted signal before the datastore', async () => {
    const { context, reads } = fakeContext({
      abortSignal: AbortSignal.abort(),
    });

    await expect(
      readProjectResource(context, 'read', 'projects://'),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(reads()).toBe(0);
  });
});

describe('readProjectResource native selection', () => {
  it('applies an outline to the rendered source', async () => {
    vi.spyOn(
      ProjectDiscoveryRepository.prototype,
      'listProjects',
    ).mockResolvedValue([projectRow()]);
    const { context } = fakeContext();

    const result = await readProjectResource(
      context,
      'read',
      'projects://:outline',
    );

    expect(result.status).toBe('success');
    expect(successOf(result)['representation']).toBe('outline');
  });

  it('applies a raw read and multiple ranges', async () => {
    vi.spyOn(
      ProjectDiscoveryRepository.prototype,
      'listProjects',
    ).mockResolvedValue([projectRow()]);
    const { context } = fakeContext();

    const raw = await readProjectResource(context, 'read', 'projects://:raw');

    const ranged = await readProjectResource(
      context,
      'read',
      'projects://:1-1,2-2',
    );

    expect(successOf(raw)['representation']).toBe('raw');
    expect(ranged.status).toBe('success');
  });

  it('resolves an end-relative selector against the rendered source', async () => {
    vi.spyOn(
      ProjectDiscoveryRepository.prototype,
      'listProjects',
    ).mockResolvedValue([projectRow()]);
    const { context } = fakeContext();

    const result = await readProjectResource(context, 'read', 'projects://:1-');

    expect(result.status).toBe('success');
  });

  it('reports a native selector refusal as invalid_selector', async () => {
    const list = vi
      .spyOn(ProjectDiscoveryRepository.prototype, 'listProjects')
      .mockResolvedValue([projectRow()]);

    const { context, reads } = fakeContext();

    const result = await readProjectResource(
      context,
      'read',
      'projects://:5-2',
    );

    expect(errorTypeOf(result)).toBe('invalid_selector');
    // The bounds are malformed, so the grammar refuses them before the read.
    expect(reads()).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });

  it('refuses a start past the rendered last line after the read', async () => {
    vi.spyOn(
      ProjectDiscoveryRepository.prototype,
      'listProjects',
    ).mockResolvedValue([projectRow()]);
    const { context, reads } = fakeContext();

    const result = await readProjectResource(
      context,
      'read',
      'projects://:999-',
    );

    // Only the fetched source can place this member, so the refusal comes
    // after the one transaction that fetched it.
    expect(errorTypeOf(result)).toBe('invalid_selector');
    expect(reads()).toBe(1);
  });
});
