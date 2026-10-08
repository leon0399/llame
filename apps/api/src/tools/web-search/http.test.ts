import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EngineFailure, type FailureClass } from './chain';
import {
  fetchVendorHtml,
  fetchVendorJson,
  VENDOR_RESPONSE_MAX_BYTES,
  type VendorFetch,
  type VendorFetchOptions,
} from './http';

const options = (fetch: VendorFetch): VendorFetchOptions => ({
  signal: new AbortController().signal,
  fetch,
});
const schema = z.unknown();

async function expectFailure(
  fetch: VendorFetch,
  failureClass: FailureClass,
): Promise<void> {
  await expect(
    fetchVendorJson(
      'https://vendor.example/search',
      { method: 'GET' },
      options(fetch),
      schema,
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
        schema,
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
        schema,
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
        schema,
      ),
    ).resolves.toEqual({ ok: true });
  });
  it('accepts HTML content type with casing and spacing', async () => {
    await expect(
      fetchVendorHtml(
        'https://vendor.example/search',
        { method: 'GET' },
        options(() =>
          Promise.resolve(
            new Response('<html>ok</html>', {
              headers: { 'content-type': 'Text/HTML ; charset=utf-8' },
            }),
          ),
        ),
      ),
    ).resolves.toBe('<html>ok</html>');
  });
  it.each(['text/plain', '+json', undefined])(
    'rejects a non-JSON content type before reading (%s)',
    async (contentType) => {
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
    },
  );

  it('classifies a body over the vendor byte bound as upstream error', async () => {
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
        schema,
      ),
    ).rejects.toMatchObject({ failureClass: 'upstream_error' });
  });

  it('rejects an oversized content-length claim before reading', async () => {
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
        schema,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ failureClass: 'upstream_error' }),
    );
  });

  it('keeps vendor failures non-disclosing', async () => {
    const key = 'secret-key';
    await expect(
      fetchVendorJson(
        'https://vendor.example/search',
        { method: 'GET' },
        options(() => Promise.resolve(new Response(key, { status: 401 }))),
        schema,
      ),
    ).rejects.toEqual(expect.objectContaining({ failureClass: 'auth' }));
    await expectFailure(
      () => Promise.resolve(new Response('body', { status: 503 })),
      'upstream_error',
    );
    expect(new EngineFailure('auth').message).not.toContain(key);
  });
});
