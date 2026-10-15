/** HTTP-boundary tests for /api/v1/media (vision-media D3, pdf-media D2-D3). */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type Server } from 'node:http';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import request from 'supertest';
import sharp from 'sharp';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { mediaBlobs, mediaObjects } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ModelsService } from '../models/models.service';
import { ScriptedModelsService } from '../runs/scripted-model-client';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { executeMediaRead } from '../tools/media-read';
import { randomPng } from './media-fixtures';
import { MEDIA_REFUSAL } from './media-ingest';
import { MediaService } from './media.service';
import * as preparation from './pdf-preparation';
import { createToolMediaStore } from './tool-media-store';

vi.setConfig({ testTimeout: 30_000 });

const descriptorSchema = z.strictObject({
  id: z.string(),
  locator: z.string(),
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

const pdfDescriptorSchema = z.strictObject({
  id: z.string(),
  locator: z.string(),
  mediaType: z.literal('application/pdf'),
  name: z.string(),
  byteSize: z.number(),
  pages: z.number(),
});

/** A PDF fixture of the pdf-preparation suite. */
const pdfFixture = (name: string) =>
  readFile(join(__dirname, 'testing/pdf', name));

const UNKNOWN_ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

describe('/api/v1/media (HTTP)', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let tenantDb: TenantDbService;
  const tag = Date.now();
  // A scripted model, so a send reaches the attachment checks.
  const models = new ScriptedModelsService();
  const MODEL = `media-model-${tag}`;
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
    models.register(MODEL, { kind: 'complete', text: 'ok' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
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
      const bytes = await randomPng();
      await request(http)
        .post('/api/v1/media')
        .set('Cookie', cookieA)
        .field('ownerUserId', 'someone-else')
        .attach('file', bytes, 'owned.png')
        .expect(400);

      expect(await countOwned(userAId, bytes)).toBe(0);
    });

    it('reuses the object for the same bytes with 200, keeping the first name', async () => {
      const bytes = await randomPng();
      const first = await uploaded(cookieA, bytes, 'first.png');

      const again = await upload(cookieA, bytes, 'second.png').expect(200);

      expect(descriptorSchema.parse(again.body)).toEqual(first);
      expect(first.name).toBe('first.png');
      expect(await countOwned(userAId, bytes)).toBe(1);
    });

    it("never reuses another owner's object", async () => {
      const bytes = await randomPng();
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
        await randomPng(),
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
        message: MEDIA_REFUSAL.unsupportedImage.message,
        code: MEDIA_REFUSAL.unsupportedImage.code,
      });
      expect(await countOwned(userAId, empty)).toBe(0);
    });

    it('answers a 21 MiB file 413 with the media_too_large body shape of an ingest refusal', async () => {
      const big = Buffer.concat([
        await randomPng(),
        Buffer.alloc(21 * 1024 * 1024),
      ]);
      const tooBig = await upload(cookieA, big).expect(413);

      expect(tooBig.body).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: MEDIA_REFUSAL.fileTooLarge.message,
        code: MEDIA_REFUSAL.fileTooLarge.code,
      });
      expect(await countOwned(userAId, big)).toBe(0);

      // A small file whose header declares 41 megapixels is refused by
      // ingest, not by multer; only the message, naming the image, differs.
      const header = await sharp({
        create: { width: 1, height: 1, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer();
      header.writeUInt32BE(8000, 16);
      header.writeUInt32BE(5125, 20);
      header.writeUInt32BE(crc32(header.subarray(12, 29)), 29);
      const overPixels = await upload(cookieA, header).expect(413);
      expect(overPixels.body).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: MEDIA_REFUSAL.imageTooLarge.message,
        code: MEDIA_REFUSAL.imageTooLarge.code,
      });
    });

    it('refuses a request with two files as 400 and stores nothing', async () => {
      const one = await randomPng();
      const two = await randomPng();

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
      const bytes = await randomPng();
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

  describe('PDF', () => {
    let onePage: Buffer;
    let pdf: z.infer<typeof pdfDescriptorSchema>;

    const uploadPdf = (cookie: string, bytes: Buffer) =>
      upload(cookie, bytes, 'scan.pdf', 'application/pdf');

    beforeAll(async () => {
      onePage = await pdfFixture('one-page.pdf');
      pdf = pdfDescriptorSchema.parse(
        (await uploadPdf(cookieA, onePage).expect(201)).body,
      );
    });

    it('serves another media request while a PDF parser is stalled', async () => {
      const original = preparation.preparePdf;
      // Real HTTP and child deadlines: fake time cannot prove concurrent request availability.
      const child = preparation.pdfParseChild(
        ['-e', 'setTimeout(() => undefined, 60000)'],
        5000,
      );
      let entered = false;
      let finished = false;
      const parse = vi
        .spyOn(preparation, 'preparePdf')
        .mockImplementation((bytes) => {
          entered = true;
          return original(bytes, child);
        });
      const pending = uploadPdf(
        cookieA,
        Buffer.from('%PDF- stalled parser fixture'),
      ).then((response) => {
        finished = true;
        return response;
      });
      try {
        await vi.waitFor(() => expect(entered).toBe(true), { timeout: 2000 });
        await request(http)
          .get(`/api/v1/media/${pdf.id}`)
          .set('Cookie', cookieA)
          .timeout({ deadline: 2000 })
          .expect(200);
        expect(finished).toBe(false);
        expect((await pending).status).toBe(415);
      } finally {
        parse.mockRestore();
        await pending;
      }
    });

    it('returns the closed PDF descriptor and stores only the original', async () => {
      expect(pdf).toEqual({
        id: pdf.id,
        locator: `media://${pdf.id}`,
        mediaType: 'application/pdf',
        name: 'scan.pdf',
        byteSize: onePage.length,
        pages: 1,
      });
      const res = await request(http)
        .get(`/api/v1/media/${pdf.id}`)
        .set('Cookie', cookieA)
        .expect(200);
      expect(pdfDescriptorSchema.parse(res.body)).toEqual(pdf);

      const variants = await tenantDb.runAs(userAId, (tx) =>
        tx
          .select({ variant: mediaBlobs.variant })
          .from(mediaBlobs)
          .where(eq(mediaBlobs.mediaId, pdf.id)),
      );
      expect(variants).toEqual([{ variant: 'original' }]);
    });

    it("reuses the owner's PDF for the same bytes, whatever the declared type", async () => {
      const again = await upload(
        cookieA,
        onePage,
        'scan.png',
        'image/png',
      ).expect(200);

      expect(pdfDescriptorSchema.parse(again.body)).toEqual(pdf);
      expect(await countOwned(userAId, onePage)).toBe(1);
    });

    it('serves the original bytes as application/pdf with the safe headers', async () => {
      const res = await request(http)
        .get(`/api/v1/media/${pdf.id}/original`)
        .set('Cookie', cookieA)
        .responseType('blob')
        .expect(200);

      expect(onePage.equals(z.instanceof(Buffer).parse(res.body))).toBe(true);
      expect(res.headers).toMatchObject({
        'content-type': 'application/pdf',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
        'content-security-policy': 'sandbox',
        'cache-control': 'private, no-cache',
      });
      expect(res.headers['etag']).toMatch(/^"[^"]+"$/u);
    });

    it('answers /model of a PDF with the 404 of an unknown id, never 304', async () => {
      const sha256 = createHash('sha256').update(onePage).digest('hex');
      const unknown = await request(http)
        .get(`/api/v1/media/${UNKNOWN_ID}/model`)
        .set('Cookie', cookieA)
        .expect(404);

      const cases: Array<Record<string, string>> = [
        {},
        { 'If-None-Match': `"${sha256}-model"` },
      ];
      for (const headers of cases) {
        const res = await request(http)
          .get(`/api/v1/media/${pdf.id}/model`)
          .set('Cookie', cookieA)
          .set(headers)
          .expect(404);
        expect(res.body).toEqual(unknown.body);
        // Express sets its own body ETag on a 404; the variant validator is never set.
        expect(res.headers['etag']).toBe(unknown.headers['etag']);
      }
    });

    it("answers owner B's requests for owner A's PDF 404 on every route", async () => {
      for (const suffix of ['', '/original', '/model']) {
        const res = await request(http)
          .get(`/api/v1/media/${pdf.id}${suffix}`)
          .set('Cookie', cookieB)
          .expect(404);
        expect(res.headers['content-type']).not.toMatch(/^application\/pdf/u);
      }
    });

    it('refuses a 101-page PDF 413 and stores nothing', async () => {
      const bytes = await pdfFixture('hundred-one-pages.pdf');
      const res = await uploadPdf(cookieA, bytes).expect(413);

      expect(res.body).toEqual({
        statusCode: 413,
        error: 'Payload Too Large',
        message: MEDIA_REFUSAL.pdfTooLarge.message,
        code: MEDIA_REFUSAL.pdfTooLarge.code,
      });
      expect(await countOwned(userAId, bytes)).toBe(0);
    });

    it('refuses an encrypted PDF 415 and stores nothing', async () => {
      const bytes = await pdfFixture('owner-password.pdf');
      const res = await uploadPdf(cookieA, bytes).expect(415);

      expect(res.body).toEqual({
        statusCode: 415,
        error: 'Unsupported Media Type',
        message: MEDIA_REFUSAL.unopenablePdf.message,
        code: MEDIA_REFUSAL.unopenablePdf.code,
      });
      expect(await countOwned(userAId, bytes)).toBe(0);
    });

    // Interim guard (pdf-store until pdf-attachments).
    it('refuses a message naming a stored PDF 400 and stores no message', async () => {
      const chatId = randomUUID();
      const res = await request(http)
        .post(`/api/v1/chats/${chatId}/messages`)
        .set('Cookie', cookieA)
        .send({
          modelId: MODEL,
          message: {
            id: randomUUID(),
            parts: [
              { type: 'text', text: 'summarize' },
              { type: 'file', mediaType: 'application/pdf', url: pdf.locator },
            ],
          },
        })
        .expect(400);

      expect(res.body).toMatchObject({
        message: 'PDF attachments are not supported yet',
      });
      await tenantDb.runAs(userAId, async (tx) => {
        expect(
          await new ChatsRepository(tx).findById(chatId, userAId),
        ).toBeUndefined();
        expect(
          await new MessagesRepository(tx).findByChatId(chatId, userAId),
        ).toEqual([]);
      });
    });

    // Interim guard (pdf-store until pdf-read).
    it('fails a media:// read of a stored PDF as unsupported_media_type', async () => {
      const store = createToolMediaStore(
        new MediaService(tenantDb),
        userAId,
        new Map(),
        true,
      );

      expect(
        await executeMediaRead(store, 'read', pdf.locator, undefined),
      ).toEqual({
        status: 'error',
        type: 'unsupported_media_type',
        message: 'PDF reads are not supported yet',
      });
    });
  });

  describe('retention', () => {
    it('has no delete route; the object stays fetchable', async () => {
      const media = await uploaded(cookieA, await randomPng(), 'keep.png');

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
