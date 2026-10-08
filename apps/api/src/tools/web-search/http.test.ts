import { describe, expect, it, vi } from 'vitest';
import { EngineFailure, type FailureClass } from './chain';
import {
  fetchVendorJson,
  VENDOR_RESPONSE_MAX_BYTES,
  type VendorFetch,
  type VendorFetchOptions,
} from './http';

const options = (fetch: VendorFetch): VendorFetchOptions => ({
  signal: new AbortController().signal,
  fetch,
});
// SAFETY: JSON.parse's unknown result is intentionally passed to the parser seam.
const parse = vi.fn((body: string) => JSON.parse(body) as unknown);

async function expectFailure(
  fetch: VendorFetch,
  failureClass: FailureClass,
): Promise<void> {
  await expect(
    fetchVendorJson(
      'https://vendor.example/search',
      { method: 'GET' },
      options(fetch),
      parse,
    ),
  ).rejects.toMatchObject({ failureClass });
}

describe('web search vendor HTTP', () => {
  it('classifies a status below 200 as an upstream error', async () => {
    const response = new Response(null, {
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(response, 'status', { value: 199 });
    await expect(
      fetchVendorJson(
        'https://vendor.example/search',
        { method: 'GET' },
        options(() => Promise.resolve(response)),
        () => ({}),
      ),
    ).rejects.toMatchObject({ failureClass: 'upstream_error' });
  });
  it('classifies status 300 as an upstream error', async () => {
    await expect(
      fetchVendorJson(
        'https://vendor.example/search',
        { method: 'GET' },
        options(() =>
          Promise.resolve(
            new Response(null, {
              status: 300,
              headers: { 'content-type': 'application/json' },
            }),
          ),
        ),
        () => ({}),
      ),
    ).rejects.toMatchObject({ failureClass: 'upstream_error' });
  });

  it('classifies HTTP 403 as authentication failure', async () => {
    await expectFailure(
      () => Promise.resolve(new Response('{}', { status: 403 })),
      'auth',
    );
  });

  it.each([
    'application/json',
    'APPLICATION/JSON; charset=utf-8',
    ' application/json ; charset=utf-8',
    ' application/problem+json ; charset=utf-8',
    'application/problem+json; charset=utf-8',
  ])('accepts JSON content type %s', async (contentType) => {
    parse.mockClear();
    await expect(
      fetchVendorJson(
        'https://vendor.example/search',
        { method: 'GET' },
        options(() =>
          Promise.resolve(
            new Response('{"ok":true}', {
              headers: { 'content-type': contentType },
            }),
          ),
        ),
        parse,
      ),
    ).resolves.toEqual({ ok: true });
    expect(parse).toHaveBeenCalledOnce();
  });

  it.each(['text/plain', '+json', undefined])(
    'rejects a non-JSON content type before reading (%s)',
    async (contentType) => {
      parse.mockClear();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode('{"ok":true}'));
            controller.close();
          },
        }),
        contentType === undefined
          ? {}
          : { headers: { 'content-type': contentType } },
      );
      await expectFailure(() => Promise.resolve(response), 'upstream_error');
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it('classifies a body over the vendor byte bound as upstream error', async () => {
    const parseBody = vi.fn(() => ({}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(VENDOR_RESPONSE_MAX_BYTES + 1));
        controller.close();
      },
    });
    await expect(
      fetchVendorJson(
        'https://vendor.example/search',
        { method: 'GET' },
        options(() =>
          Promise.resolve(
            new Response(body, {
              headers: { 'content-type': 'application/json' },
            }),
          ),
        ),
        parseBody,
      ),
    ).rejects.toMatchObject({ failureClass: 'upstream_error' });
    expect(parseBody).not.toHaveBeenCalled();
  });

  it('rejects an oversized content-length claim before reading', async () => {
    const parseBody = vi.fn(() => ({}));
    await expect(
      fetchVendorJson(
        'https://vendor.example/search',
        { method: 'GET' },
        options(() =>
          Promise.resolve(
            new Response('{}', {
              headers: {
                'content-type': 'application/json',
                'content-length': String(VENDOR_RESPONSE_MAX_BYTES + 1),
              },
            }),
          ),
        ),
        parseBody,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ failureClass: 'upstream_error' }),
    );
    expect(parseBody).not.toHaveBeenCalled();
  });

  it('keeps vendor failures non-disclosing', async () => {
    const key = 'secret-key';
    await expect(
      fetchVendorJson(
        'https://vendor.example/search',
        { method: 'GET' },
        options(() => Promise.resolve(new Response(key, { status: 401 }))),
        parse,
      ),
    ).rejects.toEqual(expect.objectContaining({ failureClass: 'auth' }));
    await expectFailure(
      () => Promise.resolve(new Response('body', { status: 503 })),
      'upstream_error',
    );
    expect(parse).not.toHaveBeenCalledWith(key);
    expect(new EngineFailure('auth').message).not.toContain(key);
  });
});
