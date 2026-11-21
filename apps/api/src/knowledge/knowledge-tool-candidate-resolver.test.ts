import { drizzle } from 'drizzle-orm/postgres-js';
import {
  nativeReadTool,
  nativeEditTool,
  nativeWriteTool,
} from '../tools/native-files';

import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { nativeGrepTool } from '../tools/grep';
import {
  KnowledgeToolCandidateResolver,
  type KnowledgeToolCandidateResolverInput,
} from './knowledge-tool-candidate-resolver';
import { KnowledgeSpaceRepository } from './knowledge-space.repository';
import { bashTool } from '../tools/bash';
import { stopTool } from '../tools/stop';
import { TOOL_REGISTRY, resolveAdvertisedTools } from '../tools/registry';

const OWNER_ID = 'owner-a';

function fakeDb() {
  return drizzle.mock();
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

  it('advertises every allowlisted native tool with no extra capability configured', async () => {
    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    expect(
      await makeInput(resolver, {
        allowedToolRules: ['read', 'edit', 'write', 'bash'],
        codeOwnedTools: [
          nativeReadTool,
          nativeEditTool,
          nativeWriteTool,
          bashTool,
        ],
      }),
    ).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeReadTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeEditTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeWriteTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: bashTool,
      },
    ]);
  });

  it('advertises the same catalog on a worker that hosts the Machine and one that reaches it', async () => {
    const local = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        machines: {
          local: 'host-a',
          default: 'host-a',
          hosts: { 'host-a': {} },
        },
      },
    });

    const remote = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        machines: {
          local: 'host-b',
          default: 'devl',
          hosts: { 'host-b': {}, devl: { destination: 'box' } },
        },
      },
    });

    const catalogOf = async (resolver: KnowledgeToolCandidateResolver) =>
      (
        await makeInput(resolver, {
          allowedToolRules: ['read', 'edit', 'write', 'bash'],
          codeOwnedTools: [
            nativeReadTool,
            nativeEditTool,
            nativeWriteTool,
            bashTool,
          ],
        })
      ).map((candidate) =>
        candidate.state === 'available' ? candidate.tool.id : candidate.id,
      );

    expect(await catalogOf(local)).toEqual(await catalogOf(remote));
    expect(await catalogOf(local)).toEqual(['read', 'edit', 'write', 'bash']);
  });

  it('offers native candidates with the operator Machines configured', async () => {
    const resolver = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        machines: {
          local: 'host-a',
          default: 'host-a',
          hosts: { 'host-a': {} },
        },
      },
    });

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['read', 'edit', 'write'],
      codeOwnedTools: [nativeReadTool, nativeEditTool, nativeWriteTool],
    });

    expect(candidates).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeReadTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeEditTool,
      },
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeWriteTool,
      },
    ]);
  });

  it('offers the native tools when Machines are configured without a local executor', async () => {
    const resolver = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        machines: {
          ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
          hosts: { devl: { destination: 'box' } },
        },
      },
    });

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['read', 'edit', 'write', 'bash'],
      codeOwnedTools: [
        nativeReadTool,
        nativeEditTool,
        nativeWriteTool,
        bashTool,
      ],
    });

    expect(
      candidates.map((candidate) =>
        candidate.state === 'available' ? candidate.tool.id : candidate.id,
      ),
    ).toEqual(['read', 'edit', 'write', 'bash']);
  });

  it('admits bash whenever it is allowlisted', async () => {
    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['bash'],
      codeOwnedTools: [bashTool],
    });

    expect(candidates).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: bashTool,
      },
    ]);
  });

  describe('stop', () => {
    /** What the turn offers: the host gate, then the operator allowlist. */
    const advertised = async (
      overrides: Partial<InstanceConfigReader['config']>,
      allowedToolRules: Array<string>,
    ) => {
      const candidates = await makeInput(
        new KnowledgeToolCandidateResolver({
          config: { ...BUILT_IN_DEFAULTS, ...overrides },
        }),
        { allowedToolRules, codeOwnedTools: [bashTool, stopTool] },
      );

      return resolveAdvertisedTools(
        allowedToolRules,
        candidates.flatMap((candidate) =>
          candidate.state === 'available' ? [candidate.tool] : [],
        ),
      ).map((tool) => tool.id);
    };

    it('is offered with bash and its own allowlist entry', async () => {
      expect(await advertised({}, ['bash', 'stop'])).toEqual(['bash', 'stop']);
    });

    it('needs its own allowlist entry, apart from bash', async () => {
      expect(await advertised({}, ['bash'])).toEqual(['bash']);
      expect(await advertised({}, ['stop'])).toEqual([]);
    });

    it('is not offered when bash is not allowlisted', async () => {
      expect(
        await advertised(
          {
            machines: {
              local: 'host-a',
              default: 'host-a',
              hosts: { 'host-a': {} },
            },
          },
          ['stop'],
        ),
      ).toEqual([]);
    });
  });

  it('does not query the owner row when no Knowledge tool is allowlisted', async () => {
    const findForOwnerForBinding = vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    );

    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    await makeInput(resolver);

    expect(findForOwnerForBinding).not.toHaveBeenCalled();
  });

  it('keeps knowledge_search callable when configured root has zero owner rows', async () => {
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

  it('marks knowledge_search unavailable when the configured root is absent', async () => {
    const findForOwnerForBinding = vi.spyOn(
      KnowledgeSpaceRepository.prototype,
      'findForOwnerForBinding',
    );

    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['knowledge_search'],
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
    ]);
  });

  it('does not treat a code-owned wildcard as a Knowledge allowlist entry', async () => {
    const resolver = new KnowledgeToolCandidateResolver(makeConfig(undefined));

    const candidates = await makeInput(resolver, {
      allowedToolRules: ['knowledge_*'],
    });

    expect(
      candidates.filter(
        (candidate) =>
          candidate.state === 'unavailable' &&
          candidate.id === 'knowledge_search',
      ),
    ).toEqual([]);
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

  it('admits grep on a Knowledge root alone', async () => {
    const resolver = new KnowledgeToolCandidateResolver(
      makeConfig('/srv/knowledge'),
    );

    expect(
      await makeInput(resolver, {
        allowedToolRules: ['grep'],
        codeOwnedTools: [nativeGrepTool],
      }),
    ).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeGrepTool,
      },
    ]);
  });

  it('admits grep on a configured Machine alone', async () => {
    const resolver = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        machines: {
          local: 'host-a',
          default: 'host-a',
          hosts: { 'host-a': {} },
        },
      },
    });

    expect(
      await makeInput(resolver, {
        allowedToolRules: ['grep'],
        codeOwnedTools: [nativeGrepTool],
      }),
    ).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeGrepTool,
      },
    ]);
  });

  it('admits grep on an operator skill source alone', async () => {
    const resolver = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        skills: { directories: ['/srv/skills'] },
      },
    });

    expect(
      await makeInput(resolver, {
        allowedToolRules: ['grep'],
        codeOwnedTools: [nativeGrepTool],
      }),
    ).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeGrepTool,
      },
    ]);
  });

  it('admits grep on a configured local Machine with no other backend', async () => {
    const resolver = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        machines: {
          local: 'host-a',
          default: 'host-a',
          hosts: { 'host-a': {} },
        },
        skills: { directories: [] },
      },
    });

    expect(
      await makeInput(resolver, {
        allowedToolRules: ['grep'],
        codeOwnedTools: [nativeGrepTool],
      }),
    ).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeGrepTool,
      },
    ]);
  });

  it('admits grep on a configured Machine alone', async () => {
    const resolver = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        machines: {
          ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
          hosts: { devl: { destination: 'box' } },
        },
      },
    });

    expect(
      await makeInput(resolver, {
        allowedToolRules: ['grep'],
        codeOwnedTools: [nativeGrepTool],
      }),
    ).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeGrepTool,
      },
    ]);
  });

  it('advertises grep with no other capability configured', async () => {
    const resolver = new KnowledgeToolCandidateResolver({
      config: { ...BUILT_IN_DEFAULTS, skills: { directories: [] } },
    });

    expect(
      await makeInput(resolver, {
        allowedToolRules: ['grep'],
        codeOwnedTools: [nativeGrepTool],
      }),
    ).toEqual([
      {
        source: { type: 'code_owned' },
        state: 'available',
        tool: nativeGrepTool,
      },
    ]);
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
