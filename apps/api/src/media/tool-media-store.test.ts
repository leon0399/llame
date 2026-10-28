import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { RetainedMedia } from './attempt-media';
import { MEDIA_MAX_BYTES } from './media-ingest';
import type { MediaService } from './media.service';
import { randomPng, storedPdfRow } from './media-fixtures';
import { createToolMediaStore } from './tool-media-store';

const OWNER = 'owner';
const PDF_ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

describe('createToolMediaStore', () => {
  it('returns the stored PDF locator, size, and pages', async () => {
    const findOwned = vi.fn<MediaService['findOwned']>(() =>
      Promise.resolve(
        storedPdfRow({
          ownerUserId: OWNER,
          id: PDF_ID,
          pageCount: 15,
          byteSize: 1024,
        }),
      ),
    );
    const store = createToolMediaStore({ findOwned }, OWNER, new Map());

    await expect(store.findMedia(PDF_ID)).resolves.toEqual({
      status: 'success',
      kind: 'pdf',
      media: `media://${PDF_ID}`,
      pages: 15,
      mediaType: 'application/pdf',
      byteSize: 1024,
    });
  });

  it("keeps an unstored PDF's original as base64 in the attempt's map", async () => {
    const bytes = readFileSync(
      path.join(__dirname, 'testing/pdf/fifteen-pages.pdf'),
    );
    const retained = new Map<string, RetainedMedia>();
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, retained);

    const result = await store.readMedia(
      '/work/report.pdf',
      'call-1',
    )({
      kind: 'pdf',
      byteSize: bytes.byteLength,
      readBytes: () => Promise.resolve(bytes),
    });

    expect(result).toEqual({
      status: 'success',
      kind: 'pdf',
      mediaType: 'application/pdf',
      pages: 15,
      byteSize: bytes.byteLength,
    });
    expect(retained.get('call-1')).toEqual({
      locator: '/work/report.pdf',
      pages: 15,
      data: bytes.toString('base64'),
    });
  });

  it("keeps an unstored image's model variant with its own dimensions", async () => {
    const bytes = await randomPng(400, 300);
    const retained = new Map<string, RetainedMedia>();
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, retained);

    const result = await store.readMedia(
      '/work/shot.png',
      'call-1',
    )({
      kind: 'image',
      byteSize: bytes.byteLength,
      readBytes: () => Promise.resolve(bytes),
    });

    expect(result).toMatchObject({
      status: 'success',
      kind: 'image',
      mediaType: 'image/png',
      width: 400,
      height: 300,
    });
    expect(result).not.toHaveProperty('media');
    const entry = retained.get('call-1');
    expect(entry).toMatchObject({
      locator: '/work/shot.png',
      width: 400,
      height: 300,
      model: { mediaType: 'image/png', width: 400, height: 300 },
    });
    // Base64 of the model variant, not of the original: the entry carries the
    // bytes a request would attach.
    expect(entry && 'model' in entry ? entry.model.data : '').toMatch(
      /^[A-Za-z0-9+/]+={0,2}$/u,
    );
  });

  it('refuses an oversized PDF before loading its bytes', async () => {
    const retained = new Map<string, RetainedMedia>();
    const readBytes = vi.fn<() => Promise<Buffer>>();
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, retained);

    await expect(
      store.readMedia(
        '/work/large.pdf',
        'call-1',
      )({
        kind: 'pdf',
        byteSize: MEDIA_MAX_BYTES + 1,
        readBytes,
      }),
    ).resolves.toMatchObject({ status: 'error', type: 'media_too_large' });
    expect(readBytes).not.toHaveBeenCalled();
    expect(retained.has('call-1')).toBe(false);
  });

  it('refuses an encrypted PDF without retaining it', async () => {
    const bytes = readFileSync(
      path.join(__dirname, 'testing/pdf/owner-password.pdf'),
    );
    const retained = new Map<string, RetainedMedia>();
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, retained);

    await expect(
      store.readMedia(
        '/work/private.pdf',
        'call-1',
      )({
        kind: 'pdf',
        byteSize: bytes.byteLength,
        readBytes: () => Promise.resolve(bytes),
      }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'unsupported_media_type',
    });
    expect(retained.has('call-1')).toBe(false);
  });

  it('retains nothing when the read is abandoned during preparation', async () => {
    const bytes = readFileSync(
      path.join(__dirname, 'testing/pdf/one-page.pdf'),
    );
    const retained = new Map<string, RetainedMedia>();
    const controller = new AbortController();
    const reason = new Error('read abandoned');
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, retained);

    await expect(
      store.readMedia(
        '/work/report.pdf',
        'call-1',
      )({
        kind: 'pdf',
        byteSize: bytes.byteLength,
        signal: controller.signal,
        readBytes: () => {
          controller.abort(reason);
          return Promise.resolve(bytes);
        },
      }),
    ).rejects.toBe(reason);
    expect(retained.has('call-1')).toBe(false);
  });

  it('reports a cancelled read, not the refusal it would otherwise take', async () => {
    // An encrypted PDF is a preparation refusal; the same read cancelled
    // before preparation is the cancellation, so the parser saw the signal.
    const bytes = readFileSync(
      path.join(__dirname, 'testing/pdf/owner-password.pdf'),
    );
    const retained = new Map<string, RetainedMedia>();
    const controller = new AbortController();
    const reason = new Error('read abandoned');
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, retained);

    await expect(
      store.readMedia(
        '/work/private.pdf',
        'call-1',
      )({
        kind: 'pdf',
        byteSize: bytes.byteLength,
        signal: controller.signal,
        readBytes: () => {
          controller.abort(reason);
          return Promise.resolve(bytes);
        },
      }),
    ).rejects.toBe(reason);
    expect(retained.has('call-1')).toBe(false);
  });
});
