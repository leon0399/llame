import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'node:stream';

import { type MediaObject } from '../db/schema';
import { MediaIngestError } from './media-ingest';
import { MediaController } from './media.controller';
import { type MediaService } from './media.service';

type MediaApi = Pick<MediaService, 'ingest' | 'findOwned' | 'readVariant'>;
type UploadFile = Parameters<MediaController['upload']>[1];
type BytesResponse = Parameters<MediaController['getModel']>[3];

const OWNER = 'owner-a';
const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';
const SHA = 'a'.repeat(64);

const media: MediaObject = {
  id: ID,
  ownerUserId: OWNER,
  provenance: 'upload',
  name: 'shot.png',
  mediaType: 'image/png',
  width: 800,
  height: 600,
  byteSize: 1234,
  modelMediaType: 'image/png',
  modelWidth: 800,
  modelHeight: 600,
  modelByteSize: 1000,
  sha256: SHA,
  createdAt: new Date('2026-10-10T00:00:00Z'),
};

function fakeMedia(owned: MediaObject | undefined) {
  const ingest = vi.fn<MediaApi['ingest']>();
  const findOwned = vi.fn<MediaApi['findOwned']>(() => Promise.resolve(owned));
  const readVariant = vi.fn<MediaApi['readVariant']>(() =>
    Promise.resolve(Buffer.from('model-bytes')),
  );
  const api: MediaApi = { ingest, findOwned, readVariant };
  return { api, ingest, findOwned, readVariant };
}

function bytesResponse() {
  const headers = new Map<string, string>();
  const statuses: Array<number> = [];
  const bodies: Array<Buffer | undefined> = [];
  const value: BytesResponse = {
    status: (code) => statuses.push(code),
    setHeader: (name, header) => headers.set(name, header),
    end: (body) => bodies.push(body),
  };
  return { value, headers, statuses, bodies };
}

function uploadFile(bytes: Buffer, originalname: string): UploadFile {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'image/png',
    size: bytes.length,
    buffer: bytes,
    destination: '',
    filename: '',
    path: '',
    stream: Readable.from([]),
  };
}

describe('MediaController byte routes', () => {
  it('answers 404 for an id the caller does not own, even with a matching validator', async () => {
    const { api, readVariant } = fakeMedia(undefined);
    const res = bytesResponse();

    await expect(
      new MediaController(api).getModel(
        'owner-b',
        ID,
        `"${SHA}-model"`,
        res.value,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(res.statuses).toEqual([]);
    expect(res.headers.size).toBe(0);
    expect(readVariant).not.toHaveBeenCalled();
  });

  it('resolves ownership with the session owner before evaluating If-None-Match', async () => {
    const { api, findOwned, readVariant } = fakeMedia(media);
    const res = bytesResponse();

    await new MediaController(api).getModel(
      OWNER,
      ID,
      `W/"x", "${SHA}-model"`,
      res.value,
    );

    expect(findOwned).toHaveBeenCalledWith(OWNER, ID);
    expect(res.statuses).toEqual([304]);
    expect(res.bodies).toEqual([undefined]);
    expect(res.headers.get('ETag')).toBe(`"${SHA}-model"`);
    expect(readVariant).not.toHaveBeenCalled();
  });

  it('does not treat another variant validator as a match', async () => {
    const { api, readVariant } = fakeMedia(media);
    const res = bytesResponse();

    await new MediaController(api).getOriginal(
      OWNER,
      ID,
      `"${SHA}-model"`,
      res.value,
    );

    expect(res.statuses).toEqual([200]);
    expect(readVariant).toHaveBeenCalledWith(OWNER, ID, 'original');
    expect(res.headers.get('ETag')).toBe(`"${SHA}-original"`);
  });

  it('serves the stored type with the safe header set', async () => {
    const { api } = fakeMedia({ ...media, modelMediaType: 'image/jpeg' });
    const res = bytesResponse();

    await new MediaController(api).getModel(OWNER, ID, undefined, res.value);

    expect(res.statuses).toEqual([200]);
    expect(res.bodies).toEqual([Buffer.from('model-bytes')]);
    expect(Object.fromEntries(res.headers)).toEqual({
      ETag: `"${SHA}-model"`,
      'Cache-Control': 'private, no-cache',
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Content-Security-Policy': 'sandbox',
    });
  });

  it('answers the descriptor route with 404 for a non-owned id', async () => {
    const { api } = fakeMedia(undefined);
    await expect(
      new MediaController(api).getMedia('owner-b', ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

async function uploadRefusal(api: MediaApi): Promise<HttpException> {
  try {
    await new MediaController(api).upload(
      OWNER,
      uploadFile(Buffer.from('x'), 'x.png'),
      { status: vi.fn() },
    );
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected an HttpException');
}

describe('MediaController upload', () => {
  it('ingests for the session owner with the filename as source', async () => {
    const { api, ingest } = fakeMedia(undefined);
    ingest.mockResolvedValue({ media, created: true });
    const statuses: Array<number> = [];
    const bytes = Buffer.from('png');

    const descriptor = await new MediaController(api).upload(
      OWNER,
      uploadFile(bytes, 'shot.png'),
      { status: (code) => statuses.push(code) },
    );

    expect(ingest).toHaveBeenCalledWith(OWNER, {
      bytes,
      provenance: 'upload',
      source: 'shot.png',
    });
    expect(statuses).toEqual([201]);
    expect(descriptor).toEqual({
      id: ID,
      locator: `media://${ID}`,
      provenance: 'upload',
      mediaType: 'image/png',
      name: 'shot.png',
      width: 800,
      height: 600,
      byteSize: 1234,
      model: {
        mediaType: 'image/png',
        width: 800,
        height: 600,
        byteSize: 1000,
      },
    });
  });

  it('answers 200 when an existing object is reused', async () => {
    const { api, ingest } = fakeMedia(undefined);
    ingest.mockResolvedValue({ media, created: false });
    const statuses: Array<number> = [];

    await new MediaController(api).upload(
      OWNER,
      uploadFile(Buffer.from('png'), 'again.png'),
      { status: (code) => statuses.push(code) },
    );

    expect(statuses).toEqual([200]);
  });

  it('refuses a request without a file as 400', async () => {
    const { api, ingest } = fakeMedia(undefined);
    await expect(
      new MediaController(api).upload(OWNER, undefined, { status: vi.fn() }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([
    ['image_too_large', 413, 'Payload Too Large'],
    ['unsupported_media_type', 415, 'Unsupported Media Type'],
  ] as const)(
    'maps the %s refusal to %i with its code',
    async (code, status, error) => {
      const { api, ingest } = fakeMedia(undefined);
      ingest.mockRejectedValue(new MediaIngestError(code));

      const thrown = await uploadRefusal(api);

      expect(thrown.getStatus()).toBe(status);
      expect(thrown.getResponse()).toEqual({
        statusCode: status,
        error,
        message: new MediaIngestError(code).message,
        code,
      });
    },
  );
});
