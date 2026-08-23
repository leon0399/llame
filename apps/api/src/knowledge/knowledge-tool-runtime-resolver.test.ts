import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemBinding,
} from './knowledge-filesystem';
import { KnowledgeToolRuntimeResolver } from './knowledge-tool-runtime-resolver';
import { type KnowledgeSpaceBindingResolver } from './knowledge-space.service';

const binding: KnowledgeFilesystemBinding = {
  id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
  root: '/srv/knowledge',
  directory: '/srv/knowledge/6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
};

describe('KnowledgeToolRuntimeResolver', () => {
  it('passes the trusted owner to verify-only binding resolution', async () => {
    const resolveBindingForOwner = vi.fn(() =>
      Promise.resolve<KnowledgeFilesystemBinding | undefined>(binding),
    );
    const spaces: KnowledgeSpaceBindingResolver = {
      resolveBindingForOwner,
    };
    const resolver = new KnowledgeToolRuntimeResolver(spaces);

    await expect(resolver.resolveBindingForOwner('owner-a')).resolves.toBe(
      binding,
    );
    expect(resolveBindingForOwner).toHaveBeenCalledWith('owner-a');
  });

  it('preserves an absent owner binding', async () => {
    const spaces: KnowledgeSpaceBindingResolver = {
      resolveBindingForOwner: () => Promise.resolve(undefined),
    };
    const resolver = new KnowledgeToolRuntimeResolver(spaces);

    await expect(resolver.resolveBindingForOwner('owner-a')).resolves.toBe(
      undefined,
    );
  });

  it('creates a live adapter from an existing trusted binding', () => {
    const spaces: KnowledgeSpaceBindingResolver = {
      resolveBindingForOwner: () => Promise.resolve(binding),
    };
    const resolver = new KnowledgeToolRuntimeResolver(spaces);

    const adapter = resolver.createAdapter(binding);

    expect(adapter).toBeInstanceOf(KnowledgeFilesystemAdapter);
  });

  it('propagates binding errors without exposing a provisioning path', async () => {
    const error = new Error('binding failed');
    const resolveBindingForOwner = vi.fn(() => Promise.reject(error));
    const provisionForOwner = vi.fn();
    const spaces = {
      resolveBindingForOwner,
      provisionForOwner,
    };
    const resolver = new KnowledgeToolRuntimeResolver(spaces);

    await expect(resolver.resolveBindingForOwner('owner-a')).rejects.toBe(
      error,
    );
    expect(resolveBindingForOwner).toHaveBeenCalledOnce();
    expect(provisionForOwner).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(resolver))).toEqual(
      ['constructor', 'resolveBindingForOwner', 'createAdapter'],
    );
  });
});
