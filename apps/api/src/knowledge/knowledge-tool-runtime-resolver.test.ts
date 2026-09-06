import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemBinding,
} from '@workspace/knowledge-filesystem/knowledge-filesystem';
import { KnowledgeToolRuntimeResolver } from './knowledge-tool-runtime-resolver';
import { type KnowledgeSpaceBindingResolver } from './knowledge-space.service';

const binding: KnowledgeFilesystemBinding & { name: string } = {
  id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
  name: 'Personal',
  root: '/srv/knowledge',
  directory: '/srv/knowledge/6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
};

function bindingResolver(
  overrides: Partial<KnowledgeSpaceBindingResolver> = {},
): KnowledgeSpaceBindingResolver {
  return {
    resolveBindingForOwner: () => Promise.resolve(undefined),
    resolveBindingForOwnerById: () => Promise.resolve(undefined),
    listForOwnerPage: () => Promise.resolve([]),
    ...overrides,
  };
}

describe('KnowledgeToolRuntimeResolver', () => {
  it('passes the trusted owner to verify-only binding resolution', async () => {
    const resolveBindingForOwner = vi.fn(() =>
      Promise.resolve<typeof binding | undefined>(binding),
    );
    const spaces = bindingResolver({
      resolveBindingForOwner,
    });
    const resolver = new KnowledgeToolRuntimeResolver(spaces);

    await expect(resolver.resolveBindingForOwner('owner-a')).resolves.toBe(
      binding,
    );
    expect(resolveBindingForOwner).toHaveBeenCalledWith('owner-a');
  });

  it('preserves an absent owner binding', async () => {
    const spaces = bindingResolver();
    const resolver = new KnowledgeToolRuntimeResolver(spaces);

    await expect(resolver.resolveBindingForOwner('owner-a')).resolves.toBe(
      undefined,
    );
  });

  it('passes trusted owner and explicit ID to current binding resolution', async () => {
    const resolveBindingForOwnerById = vi.fn(() => Promise.resolve(binding));
    const resolver = new KnowledgeToolRuntimeResolver(
      bindingResolver({ resolveBindingForOwnerById }),
    );

    await expect(
      resolver.resolveBindingForOwnerById('owner-a', binding.id),
    ).resolves.toBe(binding);
    expect(resolveBindingForOwnerById).toHaveBeenCalledWith(
      'owner-a',
      binding.id,
    );
  });

  it('maps a bounded storage page and emits its deterministic next cursor', async () => {
    const createdAt = new Date('2026-08-23T12:00:00.000Z');
    const rows = Array.from({ length: 101 }, (_entry, index) => ({
      knowledgeSpaceId: `space-${String(index).padStart(3, '0')}`,
      ownerUserId: 'owner-a',
      name: `Space ${index}`,
      createdAt,
      updatedAt: createdAt,
    }));
    const listForOwnerPage = vi.fn(() => Promise.resolve(rows));
    const resolver = new KnowledgeToolRuntimeResolver(
      bindingResolver({ listForOwnerPage }),
    );

    const page = await resolver.listForOwnerPage('owner-a');

    expect(listForOwnerPage).toHaveBeenCalledWith('owner-a', 100, undefined);
    expect(page.spaces).toHaveLength(100);
    expect(page.nextCursor).toEqual({
      createdAt,
      id: 'space-099',
    });
  });

  it('creates a live adapter from an existing trusted binding', () => {
    const spaces = bindingResolver({
      resolveBindingForOwner: () => Promise.resolve(binding),
    });
    const resolver = new KnowledgeToolRuntimeResolver(spaces);

    const adapter = resolver.createAdapter(binding);

    expect(adapter).toBeInstanceOf(KnowledgeFilesystemAdapter);
  });

  it('propagates binding errors without exposing a provisioning path', async () => {
    const error = new Error('binding failed');
    const resolveBindingForOwner = vi.fn(() => Promise.reject(error));
    const provisionForOwner = vi.fn();
    const spaces = {
      ...bindingResolver({ resolveBindingForOwner }),
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
      [
        'constructor',
        'resolveBindingForOwner',
        'resolveBindingForOwnerById',
        'listForOwnerPage',
        'createAdapter',
      ],
    );
  });
});
