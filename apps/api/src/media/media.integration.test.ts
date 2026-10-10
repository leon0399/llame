/** HTTP-boundary tests for /api/v1/media (vision-media D3). */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { type Server } from 'node:http';
import { crc32 } from 'node:zlib';
import request from 'supertest';
import sharp from 'sharp';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { mediaObjects } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';

vi.setConfig({ testTimeout: 30_000 });

const descriptorSchema = z.strictObject({
  id: z.string(),
  locator: z.string(),
  provenance: z.enum(['upload', 'read', 'prompt-import']),
  mediaType: z.string(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  byteSize: z.number(),
  model: z.strictObject({
    mediaType: z.string(),
    width: z.number(),
    height: z.number(),
    byteSize: z.number(),
  }),
});

const UNKNOWN_ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

/** A unique PNG, so each test's digest is its own. */
function uniquePng(width = 8, height = 8): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
}

describe('/api/v1/media (HTTP)', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let tenantDb: TenantDbService;
  const tag = Date.now();
  let cookieA = '';
  let cookieB = '';
  let userAId = '';

  async function register(email: string, name: string) {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email, password: 'password123', name });
    const body: unknown = res.body;
    expectRegisteredUserId(body);
    return { cookie: cookieOf(res), userId: body.user.id };
  }

  const upload = (
    cookie: string,
    bytes: Buffer,
    filename = 'shot.png',
    contentType = 'image/png',
  ) =>
    request(http)
      .post('/api/v1/media')
      .set('Cookie', cookie)
      .attach('file', bytes, { filename, contentType });

  const uploaded = async (cookie: string, bytes: Buffer, filename?: string) =>
    descriptorSchema.parse(
      (await upload(cookie, bytes, filename).expect(201)).body,
    );

  /** Objects the owner holds with this content's digest. */
  const countOwned = async (userId: string, bytes: Buffer) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return tenantDb.runAs(
      userId,
      async (tx) =>
        (
          await tx
            .select({ id: mediaObjects.id })
            .from(mediaObjects)
            .where(eq(mediaObjects.sha256, sha256))
        ).length,
    );
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);

    const a = await register(`media-a-${tag}@test.com`, 'Media Owner A');
    cookieA = a.cookie;
    userAId = a.userId;
    cookieB = (await register(`media-b-${tag}@test.com`, 'Media Owner B'))
      .cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('upload', () => {
    it('returns 201 with the closed descriptor of an 800×600 PNG', async () => {
      const bytes = await sharp({
        create: { width: 800, height: 600, channels: 3, background: '#123456' },
      })
        .png()
        .toBuffer();

      const res = await upload(cookieA, bytes).expect(201);
      const body: unknown = res.body;
      const descriptor = descriptorSchema.parse(body);

      expect(descriptor.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(descriptor.model.byteSize).toBeGreaterThan(0);
      expect(descriptor).toEqual({
        id: descriptor.id,
        locator: `media://${descriptor.id}`,
        provenance: 'upload',
        mediaType: 'image/png',
        name: 'shot.png',
        width: 800,
        height: 600,
        byteSize: bytes.length,
        model: {
          mediaType: 'image/png',
          width: 800,
          height: 600,
          byteSize: descriptor.model.byteSize,
        },
      });
      expect(JSON.stringify(body)).not.toContain(userAId);
    });

    it('refuses a client-supplied owner field as 400 and stores nothing', async () => {
      // Any text field trips multer's `fields: 0` limit (LIMIT_FIELD_COUNT).
      const bytes = await uniquePng();
      await request(http)
        .post('/api/v1/media')
        .set('Cookie', cookieA)
        .field('ownerUserId', 'someone-else')
        .attach('file', bytes, 'owned.png')
        .expect(400);

      expect(await countOwned(userAId, bytes)).toBe(0);
    });

    it('reuses the object for the same bytes with 200, keeping the first provenance and name', async () => {
      const bytes = await uniquePng();
      const first = await uploaded(cookieA, bytes, 'first.png');

      const again = await upload(cookieA, bytes, 'second.png').expect(200);

      expect(descriptorSchema.parse(again.body)).toEqual(first);
      expect(first.name).toBe('first.png');
      expect(await countOwned(userAId, bytes)).toBe(1);
    });

    it("never reuses another owner's object", async () => {
      const bytes = await uniquePng();
      const a = await uploaded(cookieA, bytes);

      const b = await upload(cookieB, bytes).expect(201);

      expect(descriptorSchema.parse(b.body).id).not.toBe(a.id);
    });

    it('decides the format from magic bytes, not the declared name or type', async () => {
      const jpeg = await sharp(randomBytes(16 * 16 * 3), {
        raw: { width: 16, height: 16, channels: 3 },
      })
        .jpeg()
        .toBuffer();

      const res = await upload(cookieA, jpeg, 'notes.txt', 'text/plain').expect(
        201,
      );

      expect(descriptorSchema.parse(res.body)).toMatchObject({
        mediaType: 'image/jpeg',
        name: 'notes.txt',
      });
    });

    it('stores a UTF-8 filename with a forged placeholder neutralized', async () => {
      // Raw newlines cannot travel in a multipart filename parameter; the
      // control-character rule is covered by media-source-label.test.ts.
      const res = await upload(
        cookieA,
        await uniquePng(),
        'shot [image x evil.png 1×1].png',
      ).expect(201);

      expect(descriptorSchema.parse(res.body).name).toBe(
        'shot (image x evil.png 1×1).png',
      );
    });

    it('refuses SVG as 415 and stores nothing', async () => {
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" data-t="${tag}"/>`,
      );
      const res = await upload(cookieA, svg, 'a.svg', 'image/svg+xml').expect(
        415,
      );

      expect(res.body).toEqual({
        statusCode: 415,
        error: 'Unsupported Media Type',
        message: 'Only PNG, JPEG, GIF, and WebP images are accepted',
        code: 'unsupported_media_type',
      });
      expect(await countOwned(userAId, svg)).toBe(0);
    });

    it('refuses a zero-byte file as 415 and stores nothing', async () => {
      const empty = Buffer.alloc(0);
      const res = await upload(cookieA, empty, 'empty.png').expect(415);

      expect(res.body).toEqual({
        statusCode: 415,
        error: 'Unsupported Media Type',
        message: 'Only PNG, JPEG, GIF, and WebP images are accepted',
        code: 'unsupported_media_type',
      });
      expect(await countOwned(userAId, empty)).toBe(0);
    });

    it('answers a 21 MiB file 413 with the same image_too_large body as an ingest refusal', async () => {
      const big = Buffer.concat([
        await uniquePng(),
        Buffer.alloc(21 * 1024 * 1024),
      ]);
      const tooBig = await upload(cookieA, big).expect(413);

      expect(tooBig.body).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'Image exceeds 20 MiB or 40 megapixels',
        code: 'image_too_large',
      });
      expect(await countOwned(userAId, big)).toBe(0);

      // A small file whose header declares 41 megapixels is refused by
      // ingest, not by multer; both answer the identical body.
      const header = await sharp({
        create: { width: 1, height: 1, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer();
      header.writeUInt32BE(8000, 16);
      header.writeUInt32BE(5125, 20);
      header.writeUInt32BE(crc32(header.subarray(12, 29)), 29);
      const overPixels = await upload(cookieA, header).expect(413);
      expect(overPixels.body).toEqual(tooBig.body);
    });

    it('refuses a request with two files as 400 and stores nothing', async () => {
      const one = await uniquePng();
      const two = await uniquePng();

      await request(http)
        .post('/api/v1/media')
        .set('Cookie', cookieA)
        .attach('file', one, 'one.png')
        .attach('file', two, 'two.png')
        .expect(400);

      expect(await countOwned(userAId, one)).toBe(0);
      expect(await countOwned(userAId, two)).toBe(0);
    });

    it('refuses a request with no file as 400', async () => {
      await request(http)
        .post('/api/v1/media')
        .set('Cookie', cookieA)
        .expect(400);
    });

    it('refuses an unauthenticated upload as 401 and stores nothing', async () => {
      const bytes = await uniquePng();
      await request(http)
        .post('/api/v1/media')
        .attach('file', bytes, 'anon.png')
        .expect(401);
      expect(await countOwned(userAId, bytes)).toBe(0);
    });
  });

  describe('fetch', () => {
    let jpeg: Buffer;
    let media: z.infer<typeof descriptorSchema>;

    beforeAll(async () => {
      jpeg = await sharp(randomBytes(64 * 48 * 3), {
        raw: { width: 64, height: 48, channels: 3 },
      })
        .jpeg()
        .withExif({
          IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' },
        })
        .toBuffer();
      media = await uploaded(cookieA, jpeg, 'gps.jpg');
    });

    it('returns the descriptor to its owner', async () => {
      const res = await request(http)
        .get(`/api/v1/media/${media.id}`)
        .set('Cookie', cookieA)
        .expect(200);
      expect(descriptorSchema.parse(res.body)).toEqual(media);
    });

    it('returns the original bytes unchanged to a cookie-only request', async () => {
      // superagent buffers image/* bodies into a Buffer.
      const res = await request(http)
        .get(`/api/v1/media/${media.id}/original`)
        .set('Cookie', cookieA)
        .expect(200);

      expect(jpeg.equals(z.instanceof(Buffer).parse(res.body))).toBe(true);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['etag']).toMatch(/^"[^"]+"$/u);
    });

    it('serves the model variant with its stored type and the safe headers', async () => {
      const res = await request(http)
        .get(`/api/v1/media/${media.id}/model`)
        .set('Cookie', cookieA)
        .expect(200);

      const bytes = z.instanceof(Buffer).parse(res.body);
      expect(bytes.length).toBe(media.model.byteSize);
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'png',
        width: 64,
        height: 48,
      });
      expect(res.headers).toMatchObject({
        'content-type': media.model.mediaType,
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
        'content-security-policy': 'sandbox',
        'cache-control': 'private, no-cache',
      });
      expect(res.headers['etag']).toMatch(/^"[^"]+"$/u);
    });

    it('answers a matching If-None-Match with 304 and no body', async () => {
      const first = await request(http)
        .get(`/api/v1/media/${media.id}/model`)
        .set('Cookie', cookieA)
        .expect(200);
      const etag = z.string().parse(first.headers['etag']);

      const again = await request(http)
        .get(`/api/v1/media/${media.id}/model`)
        .set('Cookie', cookieA)
        .set('If-None-Match', etag)
        .expect(304);
      expect(again.headers['content-type']).toBeUndefined();
      expect(again.headers['etag']).toBe(etag);
      expect(again.headers['cache-control']).toBe('private, no-cache');

      // A weak-compared validator list matches too (RFC 9110).
      await request(http)
        .get(`/api/v1/media/${media.id}/model`)
        .set('Cookie', cookieA)
        .set('If-None-Match', `W/"other", W/${etag}`)
        .expect(304);

      // The original's validator differs from the model's.
      await request(http)
        .get(`/api/v1/media/${media.id}/original`)
        .set('Cookie', cookieA)
        .set('If-None-Match', etag)
        .expect(200);
    });

    it("answers another owner's id with the same 404 as an unknown or malformed id on every route", async () => {
      const original = await request(http)
        .get(`/api/v1/media/${media.id}/original`)
        .set('Cookie', cookieA)
        .expect(200);
      const etag = z.string().parse(original.headers['etag']);

      for (const suffix of ['', '/original', '/model']) {
        const responses = await Promise.all(
          [media.id, UNKNOWN_ID, 'not-a-uuid', media.id.toUpperCase()].map(
            (id) =>
              request(http)
                .get(`/api/v1/media/${id}${suffix}`)
                .set('Cookie', cookieB)
                // A validator cached under A's session must not earn a 304.
                .set('If-None-Match', etag),
          ),
        );
        for (const res of responses) {
          expect(res.status).toBe(404);
          expect(res.body).toEqual(responses[1]?.body);
          expect(res.headers['etag']).not.toBe(etag);
          expect(res.headers['content-type']).not.toMatch(/^image\//u);
        }
      }
    });

    it('refuses unauthenticated fetches as 401 without bytes', async () => {
      for (const suffix of ['', '/original', '/model']) {
        const res = await request(http)
          .get(`/api/v1/media/${media.id}${suffix}`)
          .expect(401);
        expect(res.headers['content-type']).not.toMatch(/^image\//u);
      }
    });
  });

  describe('retention', () => {
    it('has no delete route; the object stays fetchable', async () => {
      const media = await uploaded(cookieA, await uniquePng(), 'keep.png');

      const res = await request(http)
        .delete(`/api/v1/media/${media.id}`)
        .set('Cookie', cookieA);
      expect(res.status).toBe(404);

      await request(http)
        .get(`/api/v1/media/${media.id}`)
        .set('Cookie', cookieA)
        .expect(200);
      await request(http)
        .get(`/api/v1/media/${media.id}/original`)
        .set('Cookie', cookieA)
        .expect(200);
    });
  });
});
