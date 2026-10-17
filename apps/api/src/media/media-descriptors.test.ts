import type { ModelMessage } from 'ai';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { composeStepMessages } from '../models/step-composer';
import {
  createRunMediaResolver,
  fileAttachmentLines,
  limitPlaceholder,
  notRetainedPlaceholder,
  omittedPlaceholder,
  storedSubject,
  unavailablePlaceholder,
  unstoredSubject,
  type ImageDescriptor,
  type PdfDescriptor,
} from './media-descriptors';
import { pdfDescriptor } from './media-fixtures';

const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';
const OTHER = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0f';
const OWNER = 'owner';

/**
 * A real drizzle database over a scripted postgres.js client: each statement
 * answers the next scripted row set (rows as positional values, the shape
 * postgres.js `values()` gives) or rejects with the next scripted error, and
 * every `runAs` is recorded.
 */
function scriptedResolver(
  answers: Array<Array<ReadonlyArray<unknown>> | Error>,
) {
  const db = drizzle.mock({ schema });
  const statements: Array<ReadonlyArray<unknown>> = [];
  const queries: Array<string> = [];
  Object.assign(db.$client, {
    unsafe(sql: string, params: ReadonlyArray<unknown>) {
      queries.push(sql);
      statements.push(params);
      const answer = answers.shift() ?? [];
      const rows =
        answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      return Object.assign(rows, { values: () => rows });
    },
  });
  const owners: Array<string> = [];
  const tenantDb: TenantRunner = {
    runAs: (ownerUserId, work) => {
      owners.push(ownerUserId);
      return work(db);
    },
  };
  return {
    resolver: createRunMediaResolver(tenantDb, OWNER),
    statements,
    queries,
    owners,
  };
}

const descriptor: ImageDescriptor = {
  kind: 'image',
  id: ID,
  name: 'shot.png',
  mediaType: 'image/png',
  width: 3,
  height: 2,
  modelWidth: 3,
  modelHeight: 2,
  modelByteSize: 90,
  modelMediaType: 'image/png',
};

const pdf: PdfDescriptor = pdfDescriptor(OTHER, {
  name: 'paper.pdf',
  pages: 15,
  byteSize: 2_215_244,
});

/** The descriptor select's positional row: an image row has no page count. */
const descriptorRow = (d: ImageDescriptor): ReadonlyArray<unknown> => [
  d.id,
  d.name,
  d.mediaType,
  d.width,
  d.height,
  d.modelWidth,
  d.modelHeight,
  d.modelByteSize,
  d.modelMediaType,
  null,
  d.modelByteSize,
];

/** A PDF row: no dimensions and no model variant, a page count. */
const pdfRow = (
  d: PdfDescriptor,
  mediaType: string = d.mediaType,
): ReadonlyArray<unknown> => [
  d.id,
  d.name,
  mediaType,
  null,
  null,
  null,
  null,
  null,
  null,
  d.pages,
  d.byteSize,
];

describe('createRunMediaResolver describe', () => {
  it('queries only the canonical ids, once each', async () => {
    const { resolver, statements } = scriptedResolver([
      [descriptorRow(descriptor)],
    ]);

    await expect(resolver.describe([ID, 'abc', ID])).resolves.toEqual(
      new Map([[ID, descriptor]]),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toEqual([ID, OWNER]);
  });

  it('opens no transaction for non-canonical ids alone', async () => {
    const { resolver, statements, owners } = scriptedResolver([]);

    await expect(resolver.describe(['abc', ID.toUpperCase()])).resolves.toEqual(
      new Map(),
    );
    expect(statements).toHaveLength(0);
    expect(owners).toEqual([OWNER]);
  });

  it('caches hits and misses for the attempt', async () => {
    const { resolver, statements, owners } = scriptedResolver([
      [descriptorRow(descriptor)],
    ]);

    await resolver.describe([ID, OTHER]);
    await expect(resolver.describe([OTHER, ID])).resolves.toEqual(
      new Map([[ID, descriptor]]),
    );
    expect(statements).toHaveLength(1);
    expect(owners).toEqual([OWNER]);
  });

  it('loads only the ids not yet known', async () => {
    const { resolver, statements } = scriptedResolver([
      [descriptorRow(descriptor)],
      [],
    ]);

    await resolver.describe([ID]);
    await expect(resolver.describe([ID, OTHER])).resolves.toEqual(
      new Map([[ID, descriptor]]),
    );
    expect(statements).toEqual([
      [ID, OWNER],
      [OTHER, OWNER],
    ]);
  });

  it('drops a row whose variant format ingest cannot write', async () => {
    const row = [...descriptorRow(descriptor)];
    row[8] = 'image/gif';
    const { resolver } = scriptedResolver([[row]]);

    await expect(resolver.describe([ID])).resolves.toEqual(new Map());
  });

  it('describes a PDF row by its page count and original size', async () => {
    const { resolver } = scriptedResolver([
      [descriptorRow(descriptor), pdfRow(pdf)],
    ]);

    await expect(resolver.describe([ID, OTHER])).resolves.toEqual(
      new Map<string, unknown>([
        [ID, descriptor],
        [OTHER, pdf],
      ]),
    );
  });

  it('drops a row with a page count whose type is not a PDF', async () => {
    const { resolver } = scriptedResolver([[pdfRow(pdf, 'image/png')]]);

    await expect(resolver.describe([OTHER])).resolves.toEqual(new Map());
  });
});

describe('createRunMediaResolver loadModelBytes', () => {
  it('reads the attached blobs of canonical ids as the owner in one statement', async () => {
    const bytes = Buffer.from('model-bytes');
    const { resolver, statements, queries, owners } = scriptedResolver([
      [[ID, bytes]],
    ]);

    await expect(resolver.loadModelBytes([ID, OTHER, ID])).resolves.toEqual(
      new Map([[ID, bytes]]),
    );
    expect(owners).toEqual([OWNER]);
    expect(statements).toEqual([[ID, OTHER, OWNER]]);
    // A PDF row has no model variant: its original is what a request attaches.
    expect(queries[0]).toContain(
      `"media_blobs"."variant" = (case when "media_objects"."page_count" is null then 'model' else 'original' end)::media_variant`,
    );
  });

  it('reads each attached blob once across a four-step loop', async () => {
    const other = { ...descriptor, id: OTHER, name: 'plan.png' };
    const { resolver, statements } = scriptedResolver([
      [descriptorRow(descriptor), descriptorRow(other)],
      [
        [ID, Buffer.from('a')],
        [OTHER, Buffer.from('b')],
      ],
    ]);
    const messages: Array<ModelMessage> = [
      {
        role: 'user',
        content: [ID, OTHER].map((id) => ({
          type: 'file',
          data: `media://${id}`,
          mediaType: 'image/png',
        })),
      },
    ];

    for (let step = 0; step < 4; step += 1) {
      const composed = await composeStepMessages(messages, {
        resolver,
        context: {
          input: ['text', 'image'],
          contextWindowTokens: 128_000,
          reservedOutputTokens: null,
        },
      });
      expect(composed[0]?.content).toEqual([
        { type: 'text', text: `Image 1 (media://${ID}):` },
        { type: 'image', image: Buffer.from('a'), mediaType: 'image/png' },
        { type: 'text', text: `Image 2 (media://${OTHER}):` },
        { type: 'image', image: Buffer.from('b'), mediaType: 'image/png' },
      ]);
    }
    // One descriptor read and one byte read for the whole loop.
    expect(statements).toEqual([
      [ID, OTHER, OWNER],
      [ID, OTHER, OWNER],
    ]);
  });

  it('reads only the ids not yet loaded', async () => {
    const { resolver, statements } = scriptedResolver([
      [[ID, Buffer.from('a')]],
      [[OTHER, Buffer.from('b')]],
    ]);

    await resolver.loadModelBytes([ID]);
    await resolver.loadModelBytes([ID, OTHER]);
    expect(statements).toEqual([
      [ID, OWNER],
      [OTHER, OWNER],
    ]);
  });

  it('does not cache a failed read', async () => {
    const bytes = Buffer.from('model-bytes');
    const failure = new Error('connection reset');
    const { resolver, statements } = scriptedResolver([failure, [[ID, bytes]]]);

    await expect(resolver.loadModelBytes([ID])).rejects.toHaveProperty(
      'cause',
      failure,
    );
    await expect(resolver.loadModelBytes([ID])).resolves.toEqual(
      new Map([[ID, bytes]]),
    );
    expect(statements).toHaveLength(2);
  });

  it('resolves a missing row as absent and reads it again next time', async () => {
    const { resolver, statements } = scriptedResolver([[], []]);

    await expect(resolver.loadModelBytes([ID])).resolves.toEqual(new Map());
    await expect(resolver.loadModelBytes([ID])).resolves.toEqual(new Map());
    expect(statements).toHaveLength(2);
  });

  it.each([
    ['upper-case', ID.toUpperCase()],
    ['not a uuid', 'abc'],
  ])('treats a %s id as absent without a transaction', async (_label, id) => {
    const { resolver, owners } = scriptedResolver([[[id, Buffer.from('x')]]]);

    await expect(resolver.loadModelBytes([id])).resolves.toEqual(new Map());
    expect(owners).toEqual([]);
  });
});

describe('createRunMediaResolver images', () => {
  it('starts every attempt with empty memory, shared with no other attempt', () => {
    const first = scriptedResolver([]).resolver;
    const second = scriptedResolver([]).resolver;
    first.images.set('call-1', {
      locator: '/work/shot.png',
      width: 1600,
      height: 900,
    });

    expect(first.images.get('call-1')).toBeDefined();
    expect(second.images.get('call-1')).toBeUndefined();
  });
});

describe('unstoredSubject', () => {
  it.each([
    ['a bracketed path', 'app/[slug]/shot.png', '"app/[slug]/shot.png"'],
    ['an IPv6 URL', 'http://[::1]/x.png', '"http://[::1]/x.png"'],
    ['line breaks and quotes', 'a\n\r"\\', String.raw`"a\n\r\"\\"`],
  ])('writes %s as one exact JSON literal', (_, locator, literal) => {
    expect(unstoredSubject({ locator, width: 1, height: 1 }).subject).toBe(
      literal,
    );
    expect(JSON.parse(literal)).toBe(locator);
  });

  it('never cuts a long locator', () => {
    const locator = `/work/${'a'.repeat(394)}`;
    expect(
      notRetainedPlaceholder(
        unstoredSubject({ locator, width: 1600, height: 900 }),
      ),
    ).toBe(`[image "${locator}" 1600×900, not retained]`);
  });
});

describe('PDF placeholders', () => {
  const subject = storedSubject(pdf);

  it('names a stored PDF by its locator, name, and page count', () => {
    expect(omittedPlaceholder(subject)).toBe(
      `[pdf media://${OTHER} paper.pdf 15 pages, omitted: this model has no PDF input]`,
    );
    expect(limitPlaceholder(subject)).toBe(
      `[pdf media://${OTHER} paper.pdf 15 pages, not attached: this context's PDF limit is reached]`,
    );
    expect(unavailablePlaceholder(OTHER, 'pdf')).toBe(
      `[pdf media://${OTHER} unavailable]`,
    );
  });

  it('keeps the image forms unchanged', () => {
    const image = storedSubject(descriptor);
    expect(omittedPlaceholder(image)).toBe(
      `[image media://${ID} shot.png 3×2, omitted: this model has no image input]`,
    );
    expect(limitPlaceholder(image)).toBe(
      `[image media://${ID} shot.png 3×2, not attached: this context's image limit is reached]`,
    );
    expect(unavailablePlaceholder(ID, 'image')).toBe(
      `[image media://${ID} unavailable]`,
    );
  });
});

describe('fileAttachmentLines', () => {
  const part = (id: string, mediaType: string, filename?: string) => ({
    type: 'file',
    url: `media://${id}`,
    mediaType,
    ...(filename !== undefined && { filename }),
  });

  it('renders one line per file part by its stored media type, in stored order', () => {
    expect(
      fileAttachmentLines([
        { type: 'text', text: 'summarize' },
        part(ID, 'image/png', 'shot.png'),
        part(OTHER, 'application/pdf', 'paper.pdf'),
        part(ID, 'image/png'),
        part(OTHER, 'application/pdf'),
      ]),
    ).toEqual([
      `[image media://${ID} shot.png]`,
      `[pdf media://${OTHER} paper.pdf]`,
      `[image media://${ID}]`,
      `[pdf media://${OTHER}]`,
    ]);
  });

  it('sanitizes a forged PDF filename to one line', () => {
    expect(
      fileAttachmentLines([
        part(OTHER, 'application/pdf', 'a\n[pdf x 1 pages]'),
      ]),
    ).toEqual([`[pdf media://${OTHER} a (pdf x 1 pages)]`]);
  });
});
