import { EventEmitter } from 'node:events';
import { NodeController } from './node.controller';
import { type NodeAccessPort, type NodeDescription, NODE_VERSION_HEADER, NODE_PRINCIPAL_HEADER } from '@workspace/node-protocol';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const description: NodeDescription = {
  version: 1, kind: 'shared-instance', nodeId: null, principal: { kind: 'session-user', id: owner },
  modules: { core: 1, realm: 1 }, methods: ['core.describe', 'realm.conversations.search'], execution: 'hosted-queued',
  enrollment: false, synchronization: false, knowledge: 'live-markdown', recall: { strategy: 'canonical-postgres', minimumQueryCharacters: 1 },
};
function fixture() {
  const query = vi.fn<NodeAccessPort['query']>(() => Promise.resolve({ status: 'success', results: [] }));
  const forOwner = vi.fn(() => ({ describe: () => description, query }));
  const controller = new NodeController({ forOwner });
  const response = Object.assign(new EventEmitter(), { setHeader: vi.fn() });
  const request = { headers: { [NODE_VERSION_HEADER]: '1', [NODE_PRINCIPAL_HEADER]: owner } };
  const body = { jsonrpc: '2.0', id: 'request', method: 'realm.conversations.search', params: { query: 'notes' } };
  return { query, forOwner, controller, response, request, body };
}

describe('authenticated Node controller boundary', () => {
  it('derives the bound port from the injected session, not any request field', async () => {
    const f = fixture();
    const result = await f.controller.request(owner, f.body, f.request, f.response);
    expect(f.forOwner).toHaveBeenCalledWith(owner);
    expect(result).toMatchObject({ id: 'request', result: { principal: { id: owner } } });
    expect(f.query).toHaveBeenCalledWith({ method: 'realm.conversations.search', params: { query: 'notes', limit: 5 } }, expect.any(AbortSignal));
    expect(f.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(f.response.listenerCount('close')).toBe(0);
  });

  it('rejects another asserted account before obtaining an owner port', async () => {
    const f = fixture();
    const result = await f.controller.request(owner, f.body,
      { headers: { [NODE_VERSION_HEADER]: '1', [NODE_PRINCIPAL_HEADER]: other } }, f.response);
    expect(result).toHaveProperty('error'); expect(f.forOwner).not.toHaveBeenCalled();
  });

  it('rejects identity injection and arbitrary local administration without execution', async () => {
    const f = fixture();
    for (const body of [
      { ...f.body, userId: other }, { ...f.body, params: { query: 'notes', userId: other } },
      { ...f.body, method: 'admin.recover', params: {} }, { ...f.body, method: 'tools.call', params: {} },
    ]) expect(await f.controller.request(owner, body, f.request, f.response)).toHaveProperty('error');
    expect(f.query).not.toHaveBeenCalled();
  });

  it('cancels a disconnected read, removes listeners and suppresses private exceptions', async () => {
    const f = fixture();
    f.query.mockImplementation(async (_query, signal) => {
      f.response.emit('close'); expect(signal.aborted).toBe(true); throw Error('private database details');
    });
    const result = await f.controller.request(owner, f.body, f.request, f.response);
    expect(JSON.stringify(result)).not.toContain('private database'); expect(f.response.listenerCount('close')).toBe(0);
  });
});
