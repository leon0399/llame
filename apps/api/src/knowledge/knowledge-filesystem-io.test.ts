import {
  closeResource,
  isErrno,
  observe,
  observeResource,
  throwIfAborted,
} from './knowledge-filesystem-io';
import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';

describe('Knowledge filesystem I/O helpers', () => {
  it('throws the typed cancellation error only for an aborted signal', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();

    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(
      KnowledgeFilesystemError,
    );
  });

  it('observes immediate promises without a signal and propagates values', async () => {
    const promise = Promise.resolve('value');

    await expect(observe(promise, undefined)).resolves.toBe('value');
    await expect(
      observe(Promise.resolve(42), new AbortController().signal),
    ).resolves.toBe(42);
  });

  it('turns pre-aborted and in-flight aborts into cancellation errors', async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      observe(Promise.resolve('ignored'), preAborted.signal),
    ).rejects.toMatchObject({
      code: 'knowledge_cancelled',
    });

    const controller = new AbortController();
    let resolvePending!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolvePending = resolve;
    });
    const observed = observe(pending, controller.signal);
    controller.abort();
    await expect(observed).rejects.toMatchObject({
      code: 'knowledge_cancelled',
    });
    resolvePending('late');
    await pending;
  });

  it('propagates promise rejections', async () => {
    await expect(
      observe(
        Promise.reject(new Error('failure')),
        new AbortController().signal,
      ),
    ).rejects.toEqual(new Error('failure'));
  });

  it('closes a resource that resolves after cancellation', async () => {
    const controller = new AbortController();
    let resolveResource!: (resource: { close(): Promise<void> }) => void;
    const pending = new Promise<{ close(): Promise<void> }>((resolve) => {
      resolveResource = resolve;
    });
    const close = vi.fn(() => Promise.resolve());
    const observed = observeResource(() => pending, controller.signal);
    controller.abort();
    await expect(observed).rejects.toMatchObject({
      code: 'knowledge_cancelled',
    });

    resolveResource({ close });
    await pending;
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  });

  it('propagates resource factory failures and returns resources without a signal', async () => {
    const resource = { close: vi.fn(() => Promise.resolve()) };
    await expect(
      observeResource(() => Promise.resolve(resource), undefined),
    ).resolves.toBe(resource);
    await expect(
      observeResource(
        () => Promise.reject(new Error('factory failed')),
        new AbortController().signal,
      ),
    ).rejects.toEqual(new Error('factory failed'));
  });

  it('does not invoke a resource factory after cancellation', async () => {
    const controller = new AbortController();
    const factory = vi.fn(() => Promise.resolve({ close: vi.fn() }));
    controller.abort();

    await expect(
      observeResource(factory, controller.signal),
    ).rejects.toMatchObject({ code: 'knowledge_cancelled' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('translates close failures and prioritizes cancellation after close', async () => {
    const failure = new Error('close failed');
    await expect(
      closeResource({ close: vi.fn(() => Promise.reject(failure)) }, undefined),
    ).rejects.toBe(failure);

    const controller = new AbortController();
    const close = vi.fn(() => {
      controller.abort();
      return Promise.reject(failure);
    });
    await expect(
      closeResource({ close }, controller.signal),
    ).rejects.toMatchObject({
      code: 'knowledge_cancelled',
    });
  });

  it('recognizes only a string errno code on a record', () => {
    expect(isErrno({ code: 'ENOENT' }, 'ENOENT')).toBe(true);
    expect(isErrno({ code: 'ELOOP' }, 'ENOENT')).toBe(false);
    expect(isErrno({ code: 404 }, '404')).toBe(false);
    expect(isErrno(null, 'ENOENT')).toBe(false);
    expect(isErrno('ENOENT', 'ENOENT')).toBe(false);
  });
});
