import { HostedNodeAccess } from './hosted-node-access';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type KnowledgeToolResolver } from '../tools/types';
import { searchConversationsTool } from '../tools/search-conversations';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const space = '33333333-3333-4333-8333-333333333333';
const tenant = { runAs: () => Promise.reject(new Error('Unexpected database access in an adapter unit test')) };
function fixture(allowed: string[]) {
  const config: InstanceConfigReader = { config: { ...BUILT_IN_DEFAULTS, tools: { ...BUILT_IN_DEFAULTS.tools, allowed }, knowledge: { root: '/srv/notes' } } };
  const resolveBindingForOwnerById = vi.fn<KnowledgeToolResolver['resolveBindingForOwnerById']>((id, requested) => Promise.resolve(
    id === owner && requested === space ? { id: space, name: 'Notes', root: '/srv/notes', directory: '/srv/notes/owner' } : undefined,
  ));
  const resolver: KnowledgeToolResolver = {
    listForOwnerPage: () => Promise.resolve({ spaces: [] }), resolveBindingForOwnerById,
    createAdapter: () => ({ search: () => Promise.resolve([]), read: (path) => Promise.resolve({ path, offset: 0, lineCount: 1, content: '1: owner evidence' }) }),
  };
  return { config, resolveBindingForOwnerById, access: new HostedNodeAccess(tenant, config, resolver) };
}

describe('hosted Node reuses canonical capabilities under the session owner', () => {
  afterEach(() => vi.restoreAllMocks());
  it('MCP wildcards cannot authorize code-owned recall', () => {
    const { access } = fixture(['*', 'mcp__*']);
    expect(access.forOwner(owner).describe().methods).toEqual(['core.describe']);
  });
  it('calls the existing canonical recall implementation with a trusted context', async () => {
    const execute = vi.spyOn(searchConversationsTool, 'execute').mockResolvedValue({ status: 'success', results: [] });
    const { access } = fixture(['search_conversations']);
    const signal = AbortSignal.timeout(1000);
    await access.forOwner(owner).query({ method: 'realm.conversations.search', params: { query: 'notes', limit: 5 } }, signal);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ userId: owner, tenantDb: tenant, abortSignal: signal }), { query: 'notes', limit: 5 });
  });
  it('Knowledge reads cannot resolve another owner’s binding and match missing-resource behavior', async () => {
    const f = fixture(['knowledge_read']); const signal = AbortSignal.timeout(1000);
    const query = { method: 'realm.knowledge.read' as const, params: { knowledgeSpaceId: space, path: 'notes.md', offset: 0, limit: 5 } };
    const mine = await f.access.forOwner(owner).query(query, signal);
    expect(mine).toMatchObject({ status: 'success' });
    const foreign = await f.access.forOwner(other).query(query, signal);
    const missing = await f.access.forOwner(other).query({ ...query, params: { ...query.params, knowledgeSpaceId: owner } }, signal);
    expect(foreign).toEqual(missing); expect(foreign.status).toBe('error');
    expect(f.resolveBindingForOwnerById).toHaveBeenCalledWith(other, space);
  });
});
