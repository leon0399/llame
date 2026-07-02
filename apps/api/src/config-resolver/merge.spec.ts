import { resolveLayers, type ConfigLayer } from './merge';

const instance = (config: Record<string, unknown>): ConfigLayer => ({
  scope: { scopeType: 'instance', scopeId: null, version: 0 },
  config,
});
const user = (config: Record<string, unknown>, version = 1): ConfigLayer => ({
  scope: { scopeType: 'user', scopeId: 'u1', version },
  config,
});
const chat = (config: Record<string, unknown>, version = 1): ConfigLayer => ({
  scope: { scopeType: 'chat', scopeId: 'c1', version },
  config,
});

describe('resolveLayers', () => {
  it('later layers override scalars, with provenance', () => {
    const { effective, provenance } = resolveLayers([
      instance({ run: { maxOutputTokens: 1000 } }),
      user({ run: { maxOutputTokens: 100 } }),
    ]);
    expect(effective).toEqual({ run: { maxOutputTokens: 100 } });
    expect(provenance['run.maxOutputTokens']).toEqual({
      scopeType: 'user',
      scopeId: 'u1',
      version: 1,
    });
  });

  it('deep-merges objects: sibling keys from different scopes coexist', () => {
    const { effective, provenance } = resolveLayers([
      instance({
        run: { maxOutputTokens: 1000 },
        compaction: { tokenThreshold: 9000 },
      }),
      user({ compaction: { tokenThreshold: 500 } }),
      chat({ run: { maxOutputTokens: 50 } }),
    ]);
    expect(effective).toEqual({
      run: { maxOutputTokens: 50 },
      compaction: { tokenThreshold: 500 },
    });
    expect(provenance['run.maxOutputTokens']?.scopeType).toBe('chat');
    expect(provenance['compaction.tokenThreshold']?.scopeType).toBe('user');
  });

  it('arrays replace whole (fail-closed), never concat', () => {
    const { effective, provenance } = resolveLayers([
      instance({ tags: ['a', 'b'] }),
      user({ tags: ['c'] }),
    ]);
    expect(effective).toEqual({ tags: ['c'] });
    expect(provenance['tags']?.scopeType).toBe('user');
  });

  it('a scalar replacing a subtree drops the stale leaf provenance', () => {
    const { effective, provenance } = resolveLayers([
      instance({ run: { maxOutputTokens: 1000 } }),
      user({ run: 'disabled' }),
    ]);
    expect(effective).toEqual({ run: 'disabled' });
    expect(provenance['run.maxOutputTokens']).toBeUndefined();
    expect(provenance['run']?.scopeType).toBe('user');
  });

  it('undefined values in a layer set nothing', () => {
    const { effective, provenance } = resolveLayers([
      instance({ run: { maxOutputTokens: 1000 } }),
      user({ run: { maxOutputTokens: undefined } }),
    ]);
    expect(effective).toEqual({ run: { maxOutputTokens: 1000 } });
    expect(provenance['run.maxOutputTokens']?.scopeType).toBe('instance');
  });

  it('records every consulted layer, including ones that set nothing', () => {
    const { layers } = resolveLayers([instance({}), user({}), chat({})]);
    expect(layers.map((l) => l.scopeType)).toEqual([
      'instance',
      'user',
      'chat',
    ]);
  });

  it('does not mutate layer inputs', () => {
    const userConfig = { run: { maxOutputTokens: 100 } };
    const chatConfig = { run: { maxOutputTokens: 5 } };
    resolveLayers([user(userConfig), chat(chatConfig)]);
    expect(userConfig).toEqual({ run: { maxOutputTokens: 100 } });
  });
});
