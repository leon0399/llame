import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { knowledgeReadTool, knowledgeSearchTool } from './knowledge-tools';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';
import {
  KnowledgeToolCandidateResolver,
  type KnowledgeToolCandidateResolverInput,
} from './knowledge-tool-candidate-resolver';
import { searchConversationsTool } from '../tools/search-conversations';
import { TOOL_REGISTRY } from '../tools/registry';

const OWNER_ID = 'owner-a';
const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

function fakeDb(): Db {
  return drizzle.mock({ schema });
}

function makeConfig(root: string | undefined): InstanceConfigReader {
  return {
    config: {
      ...BUILT_IN_DEFAULTS,
      knowledge: root === undefined ? {} : { root },
    },
  };
}

function makeInput(
  resolver: KnowledgeToolCandidateResolver,
  overrides: Partial<KnowledgeToolCandidateResolverInput> = {},
) {
  return resolver.resolve({
    tx: fakeDb(),
    ownerUserId: OWNER_ID,
    allowedToolRules: ['search_conversations'],
    ...overrides,
  });
}

describe('KnowledgeToolCandidateResolver', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not query the owner row when no Knowledge tool is allowlisted', async () => {
    const findForOwnerForBinding = vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    );
    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    const candidates = await makeInput(resolver);

    expect(findForOwnerForBinding).not.toHaveBeenCalled();
    expect(candidates).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: searchConversationsTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: knowledgeSearchTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: knowledgeReadTool,
      },
    ]);
  });

  it('marks both Knowledge tools not configured before considering root presence', async () => {
    const findForOwnerForBinding = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'findForOwnerForBinding')
      .mockResolvedValue(undefined);
    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['knowledge_search'],
    });

    expect(findForOwnerForBinding).toHaveBeenCalledWith(OWNER_ID);
    expect(candidates).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: searchConversationsTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'unavailable',
        id: 'knowledge_search',
        classification: 'read_only',
        reason: 'knowledge_space_not_configured',
      },
      {
        source: { type: 'code_owned' },
        state: 'unavailable',
        id: 'knowledge_read',
        classification: 'read_only',
        reason: 'knowledge_space_not_configured',
      },
    ]);
  });

  it('marks both Knowledge tools unavailable when the row exists but root is absent', async () => {
    const findForOwnerForBinding = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'findForOwnerForBinding')
      .mockResolvedValue({
        knowledgeSpaceId: SPACE_ID,
        ownerUserId: OWNER_ID,
      });
    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['knowledge_search', 'knowledge_read'],
    });

    expect(findForOwnerForBinding).toHaveBeenCalledWith(OWNER_ID);
    expect(
      candidates.filter((candidate) => candidate.state === 'unavailable'),
    ).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'unavailable',
        id: 'knowledge_search',
        classification: 'read_only',
        reason: 'knowledge_space_unavailable',
      },
      {
        source: { type: 'code_owned' },
        state: 'unavailable',
        id: 'knowledge_read',
        classification: 'read_only',
        reason: 'knowledge_space_unavailable',
      },
    ]);
  });

  it('treats configured root as sufficient without probing the filesystem', async () => {
    const findForOwnerForBinding = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'findForOwnerForBinding')
      .mockResolvedValue({
        knowledgeSpaceId: SPACE_ID,
        ownerUserId: OWNER_ID,
      });
    const resolver = new KnowledgeToolCandidateResolver(
      makeConfig('/path/that/does/not/exist'),
    );

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['knowledge_search', 'knowledge_read'],
    });

    expect(findForOwnerForBinding).toHaveBeenCalledWith(OWNER_ID);
    expect(candidates).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: searchConversationsTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: knowledgeSearchTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: knowledgeReadTool,
      },
    ]);
  });

  it('uses the trusted owner and caller transaction without nesting tenantDb.runAs', async () => {
    const tx = fakeDb();
    const findForOwnerForBinding = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'findForOwnerForBinding')
      .mockResolvedValue({
        knowledgeSpaceId: SPACE_ID,
        ownerUserId: OWNER_ID,
      });
    const resolver = new KnowledgeToolCandidateResolver(
      makeConfig('/srv/knowledge'),
    );

    await resolver.resolve({
      tx,
      ownerUserId: 'trusted-owner',
      allowedToolRules: ['knowledge_search'],
    });

    expect(findForOwnerForBinding).toHaveBeenCalledWith('trusted-owner');
  });

  it('preserves non-Knowledge tools and static registry identity for a single Knowledge allowlist entry', async () => {
    const findForOwnerForBinding = vi
      .spyOn(KnowledgeSpaceRepository.prototype, 'findForOwnerForBinding')
      .mockResolvedValue(undefined);
    const resolver = new KnowledgeToolCandidateResolver(
      makeConfig('/srv/knowledge'),
    );
    const codeOwnedTools = [knowledgeSearchTool, knowledgeReadTool];

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['knowledge_read'],
      codeOwnedTools,
    });

    expect(findForOwnerForBinding).toHaveBeenCalledTimes(1);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      id: 'knowledge_search',
      state: 'unavailable',
      reason: 'knowledge_space_not_configured',
    });
    expect(candidates[1]).toMatchObject({
      id: 'knowledge_read',
      state: 'unavailable',
      reason: 'knowledge_space_not_configured',
    });
  });

  it('does not mutate the static registry while resolving candidates', async () => {
    vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    ).mockResolvedValue(undefined);
    const before = [...TOOL_REGISTRY.entries()];
    const resolver = new KnowledgeToolCandidateResolver(
      makeConfig('/srv/knowledge'),
    );

    await makeInput(resolver, {
      allowedToolRules: ['knowledge_search'],
    });

    expect([...TOOL_REGISTRY.entries()]).toEqual(before);
  });
});
