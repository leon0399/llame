import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthContext, type AuthenticatedRequest } from '../auth/auth-context';
import { type MediaObject } from '../db/schema';
import { MEDIA_MAX_BYTES, MediaIngestError } from './media-ingest';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

const OWNER = 'owner-a';
const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';
const SHA = 'a'.repeat(64);

const stored: MediaObject = {
  id: ID,
  ownerUserId: OWNER,
  provenance: 'upload',
  name: 'shot.gif',
  mediaType: 'image/gif',
  width: 8,
  height: 6,
  byteSize: 1234,
  modelMediaType: 'image/jpeg',
  modelWidth: 8,
  modelHeight: 6,
  modelByteSize: 1000,
  sha256: SHA,
  createdAt: new Date('2026-10-10T00:00:00.000Z'),
};

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
    [
      'image_too_large',
      413,
      'Payload Too Large',
      'Image exceeds 20 MiB or 40 megapixels',
    ],
    [
      'unsupported_media_type',
      415,
      'Unsupported Media Type',
      'Only PNG, JPEG, GIF, and WebP images are accepted',
    ],
  ] as const)(
    'answers an ingest %s refusal %i',
    async (code, statusCode, error, message) => {
      await withMediaApp(async (server, media) => {
        vi.spyOn(media, 'ingest').mockRejectedValue(new MediaIngestError(code));

        const response = await uploadPng(server).expect(statusCode);

        expect(response.body).toEqual({ statusCode, error, message, code });
      });
    },
  );

  it('answers a file over the byte bound with the image_too_large body', async () => {
    await withMediaApp(async (server, media) => {
      const ingest = vi.spyOn(media, 'ingest');

      const response = await uploadPng(
        server,
        Buffer.alloc(MEDIA_MAX_BYTES + 1),
      ).expect(413);

      expect(response.body).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'Image exceeds 20 MiB or 40 megapixels',
        code: 'image_too_large',
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
});
