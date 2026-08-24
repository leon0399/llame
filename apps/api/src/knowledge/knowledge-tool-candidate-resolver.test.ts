import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { knowledgeReadTool, knowledgeSearchTool } from './knowledge-tools';
import {
  KnowledgeToolCandidateResolver,
  type KnowledgeToolCandidateResolverInput,
} from './knowledge-tool-candidate-resolver';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';
import { searchConversationsTool } from '../tools/search-conversations';
import { TOOL_REGISTRY } from '../tools/registry';

const OWNER_ID = 'owner-a';

function fakeDb() {
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

  it('keeps both Knowledge tools callable when configured root has zero owner rows', async () => {
    const findForOwnerForBinding = vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    );
    const resolver = new KnowledgeToolCandidateResolver(
      makeConfig('/path/that/does/not/exist'),
    );

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['knowledge_search'],
    });

    expect(findForOwnerForBinding).not.toHaveBeenCalled();
    expect(
      candidates.filter((candidate) => candidate.state === 'unavailable'),
    ).toEqual([]);
  });

  it('marks Knowledge tools unavailable when the configured root is absent', async () => {
    const findForOwnerForBinding = vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    );
    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['knowledge_search', 'knowledge_read'],
    });

    expect(findForOwnerForBinding).not.toHaveBeenCalled();
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

  it('uses no owner transaction or filesystem probe when root is configured', async () => {
    const findForOwnerForBinding = vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    );
    const resolver = new KnowledgeToolCandidateResolver(
      makeConfig('/srv/knowledge'),
    );

    await resolver.resolve({
      tx: fakeDb(),
      ownerUserId: 'trusted-owner',
      allowedToolRules: ['knowledge_search'],
    });

    expect(findForOwnerForBinding).not.toHaveBeenCalled();
  });

  it('does not mutate the static registry while resolving candidates', async () => {
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
