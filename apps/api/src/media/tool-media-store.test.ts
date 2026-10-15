import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { HeldMedia } from './attempt-media';
import { MEDIA_MAX_BYTES } from './media-ingest';
import type { MediaService } from './media.service';
import { storedPdfRow } from './media-fixtures';
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
    const store = createToolMediaStore({ findOwned }, OWNER, new Map(), [
      'pdf',
    ]);

    await expect(store.findMedia(PDF_ID)).resolves.toEqual({
      status: 'success',
      kind: 'pdf',
      media: `media://${PDF_ID}`,
      mediaType: 'application/pdf',
      pages: 15,
      byteSize: 1024,
    });
  });

  it.each([true, false])(
    'keeps unstored PDF bytes only for a PDF-capable model: %s',
    async (pdfInput) => {
      const bytes = readFileSync(
        path.join(__dirname, 'testing/pdf/fifteen-pages.pdf'),
      );
      const held = new Map<string, HeldMedia>();
      const store = createToolMediaStore(
        { findOwned: vi.fn() },
        OWNER,
        held,
        pdfInput ? ['text', 'pdf'] : ['text', 'image'],
      );
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
      expect(held.get('call-1')).toEqual({
        locator: '/work/report.pdf',
        pages: 15,
        ...(pdfInput && { bytes, byteSize: bytes.byteLength }),
      });
    },
  );

  it('refuses an oversized PDF before loading its bytes', async () => {
    const held = new Map<string, HeldMedia>();
    const readBytes = vi.fn<() => Promise<Buffer>>();
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, held, [
      'pdf',
    ]);

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
    expect(held.has('call-1')).toBe(false);
  });

  it('refuses an encrypted PDF without retaining it', async () => {
    const bytes = readFileSync(
      path.join(__dirname, 'testing/pdf/owner-password.pdf'),
    );
    const held = new Map<string, HeldMedia>();
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, held, [
      'pdf',
    ]);

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
    expect(held.has('call-1')).toBe(false);
  });

  it('retains nothing when the read is abandoned during preparation', async () => {
    const bytes = readFileSync(
      path.join(__dirname, 'testing/pdf/one-page.pdf'),
    );
    const held = new Map<string, HeldMedia>();
    const controller = new AbortController();
    const reason = new Error('read abandoned');
    const store = createToolMediaStore({ findOwned: vi.fn() }, OWNER, held, [
      'pdf',
    ]);

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
    expect(held.has('call-1')).toBe(false);
  });
});
