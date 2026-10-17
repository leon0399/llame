import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthContext, type AuthenticatedRequest } from '../auth/auth-context';
import { type MediaObject } from '../db/schema';
import { storedPdfRow } from './media-fixtures';
import {
  MEDIA_MAX_BYTES,
  MEDIA_REFUSAL,
  MediaIngestError,
} from './media-ingest';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

const OWNER = 'owner-a';
const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';
const SHA = 'a'.repeat(64);

const stored: MediaObject = {
  id: ID,
  ownerUserId: OWNER,
  name: 'shot.gif',
  mediaType: 'image/gif',
  width: 8,
  height: 6,
  byteSize: 1234,
  modelMediaType: 'image/jpeg',
  modelWidth: 8,
  modelHeight: 6,
  modelByteSize: 1000,
  pageCount: null,
  sha256: SHA,
  createdAt: new Date('2026-10-10T00:00:00.000Z'),
};

const storedPdf = storedPdfRow({ ownerUserId: OWNER, pageCount: 15 });

/**
 * The controller behind the real Nest pipeline (multer, filters, Express
 * freshness), with the session resolved to OWNER and the service stubbed.
 */
async function withMediaApp(
  run: (server: Server, media: MediaService) => Promise<void>,
): Promise<void> {
  const media = new MediaService({ runAs: vi.fn() });
  const moduleRef = await Test.createTestingModule({
    controllers: [MediaController],
    providers: [{ provide: MediaService, useValue: media }],
  }).compile();
  const app: INestApplication<Server> = moduleRef.createNestApplication({
    logger: false,
  });
  app.use((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    req.authContext = new AuthContext(OWNER, 'session');
    next();
  });
  try {
    await app.init();
    await run(app.getHttpServer(), media);
  } finally {
    await app.close();
  }
}

function uploadPng(server: Server, bytes = Buffer.from('png')) {
  return request(server)
    .post('/api/v1/media')
    .attach('file', bytes, { filename: 'shot.png', contentType: 'image/png' });
}

describe('MediaController upload', () => {
  it('answers 400 without a file part', async () => {
    await withMediaApp(async (server) => {
      const response = await request(server).post('/api/v1/media').expect(400);
      expect(response.body).toMatchObject({
        message: 'Exactly one file field named "file"',
      });
    });
  });

  it.each([
    [MEDIA_REFUSAL.imageTooLarge, 413, 'Payload Too Large'],
    [MEDIA_REFUSAL.pdfTooLarge, 413, 'Payload Too Large'],
    [MEDIA_REFUSAL.unsupportedImage, 415, 'Unsupported Media Type'],
    [MEDIA_REFUSAL.unopenablePdf, 415, 'Unsupported Media Type'],
  ] as const)(
    'answers the ingest refusal %j with %i (%s)',
    async (refusal, statusCode, error) => {
      await withMediaApp(async (server, media) => {
        vi.spyOn(media, 'ingest').mockRejectedValue(
          new MediaIngestError(refusal),
        );

        const response = await uploadPng(server).expect(statusCode);

        expect(response.body).toEqual({
          statusCode,
          error,
          message: refusal.message,
          code: refusal.code,
        });
      });
    },
  );

  it('answers a file over the byte bound with the media_too_large body', async () => {
    await withMediaApp(async (server, media) => {
      const ingest = vi.spyOn(media, 'ingest');

      const response = await uploadPng(
        server,
        Buffer.alloc(MEDIA_MAX_BYTES + 1),
      ).expect(413);

      expect(response.body).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: MEDIA_REFUSAL.fileTooLarge.message,
        code: MEDIA_REFUSAL.fileTooLarge.code,
      });
      expect(ingest).not.toHaveBeenCalled();
    });
  });

  it('lets a failure other than a refusal surface as a 500', async () => {
    await withMediaApp(async (server, media) => {
      vi.spyOn(media, 'ingest').mockRejectedValue(new Error('db down'));

      const response = await uploadPng(server).expect(500);

      expect(response.body).not.toHaveProperty('code');
    });
  });
});

describe('MediaController descriptor', () => {
  it('answers a PDF with the closed PDF descriptor', async () => {
    await withMediaApp(async (server, media) => {
      vi.spyOn(media, 'findOwned').mockResolvedValue(storedPdf);

      const response = await request(server)
        .get(`/api/v1/media/${ID}`)
        .expect(200);

      expect(response.body).toStrictEqual({
        id: ID,
        locator: `media://${ID}`,
        mediaType: 'application/pdf',
        name: 'scan.pdf',
        byteSize: 1234,
        pages: 15,
      });
    });
  });
});

describe('MediaController byte routes', () => {
  it.each([
    ['original', 'image/gif'],
    ['model', 'image/jpeg'],
  ] as const)(
    'serves the %s bytes inline as %s under a sandbox',
    async (variant, contentType) => {
      await withMediaApp(async (server, media) => {
        vi.spyOn(media, 'findOwned').mockResolvedValue(stored);
        const readVariant = vi
          .spyOn(media, 'readVariant')
          .mockResolvedValue(Buffer.from(`${variant}-bytes`));

        const response = await request(server)
          .get(`/api/v1/media/${ID}/${variant}`)
          .expect(200);

        expect(readVariant).toHaveBeenCalledWith(OWNER, ID, variant);
        expect(response.headers).toMatchObject({
          etag: `"${SHA}-${variant}"`,
          'cache-control': 'private, no-cache',
          'content-type': contentType,
          'x-content-type-options': 'nosniff',
          'content-disposition': 'inline',
          'content-security-policy': 'sandbox',
        });
        expect(Buffer.from(response.body)).toEqual(
          Buffer.from(`${variant}-bytes`),
        );
      });
    },
  );

  it('answers 304 for a matching validator without reading the bytes', async () => {
    await withMediaApp(async (server, media) => {
      vi.spyOn(media, 'findOwned').mockResolvedValue(stored);
      const readVariant = vi.spyOn(media, 'readVariant');

      const response = await request(server)
        .get(`/api/v1/media/${ID}/model`)
        .set('If-None-Match', `"${SHA}-model"`)
        .expect(304);

      expect(response.headers.etag).toBe(`"${SHA}-model"`);
      expect(readVariant).not.toHaveBeenCalled();
    });
  });

  it('answers 404 when the variant bytes are gone', async () => {
    await withMediaApp(async (server, media) => {
      vi.spyOn(media, 'findOwned').mockResolvedValue(stored);
      vi.spyOn(media, 'readVariant').mockResolvedValue(undefined);

      await request(server).get(`/api/v1/media/${ID}/original`).expect(404);
    });
  });

  // media-store "A PDF has no model route": the same 404 as an unknown id,
  // decided before any validator is set or compared.
  it.each<[string, Record<string, string>]>([
    ['without If-None-Match', {}],
    ['with a matching If-None-Match', { 'If-None-Match': `"${SHA}-model"` }],
  ])('answers 404 for the model of a PDF %s', async (_label, headers) => {
    await withMediaApp(async (server, media) => {
      vi.spyOn(media, 'findOwned')
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue(storedPdf);
      const readVariant = vi.spyOn(media, 'readVariant');
      const unknown = await request(server)
        .get(`/api/v1/media/${ID}/model`)
        .expect(404);

      const response = await request(server)
        .get(`/api/v1/media/${ID}/model`)
        .set(headers)
        .expect(404);

      expect(response.body).toEqual(unknown.body);
      // Express sets its own body ETag on every 404; the variant validator is never set.
      expect(response.headers.etag).not.toBe(`"${SHA}-model"`);
      expect(response.headers.etag).toBe(unknown.headers.etag);
      expect(readVariant).not.toHaveBeenCalled();
    });
  });

  it('serves the original of a PDF as application/pdf', async () => {
    await withMediaApp(async (server, media) => {
      vi.spyOn(media, 'findOwned').mockResolvedValue(storedPdf);
      vi.spyOn(media, 'readVariant').mockResolvedValue(Buffer.from('%PDF-'));

      const response = await request(server)
        .get(`/api/v1/media/${ID}/original`)
        .expect(200);

      expect(response.headers).toMatchObject({
        etag: `"${SHA}-original"`,
        'content-type': 'application/pdf',
        'content-security-policy': 'sandbox',
      });
    });
  });
});
