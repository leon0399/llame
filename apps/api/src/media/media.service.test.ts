import { MediaIngestError } from './media-ingest';
import { MediaService } from './media.service';

const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

function service() {
  const runAs = vi.fn();
  runAs.mockRejectedValue(new Error('unexpected database access'));
  return { media: new MediaService({ runAs }), runAs };
}

describe('MediaService authorization', () => {
  it.each([
    ['upper-case', ID.toUpperCase()],
    ['braced', `{${ID}}`],
    ['empty', ''],
    ['not a uuid', 'abc'],
  ])(
    'treats a %s id as not found without touching the database',
    async (_label, id) => {
      const { media, runAs } = service();
      await expect(media.findOwned('owner', id)).resolves.toBeUndefined();
      await expect(
        media.readVariant('owner', id, 'model'),
      ).resolves.toBeUndefined();
      expect(runAs).not.toHaveBeenCalled();
    },
  );

  it('refuses an unsupported input before opening a transaction', async () => {
    const { media, runAs } = service();

    await expect(
      media.ingest('owner', {
        bytes: Buffer.from('<svg/>'),
        provenance: 'upload',
        source: 'x.svg',
      }),
    ).rejects.toBeInstanceOf(MediaIngestError);
    expect(runAs).not.toHaveBeenCalled();
  });
});
