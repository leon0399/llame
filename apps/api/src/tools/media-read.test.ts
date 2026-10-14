import type { ToolMediaStore } from '../media/tool-media-store';
import { executeMediaRead } from './media-read';

const PDF_ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

describe('executeMediaRead', () => {
  it('refuses a stored PDF with the unsupported-media result', async () => {
    const findImage = vi.fn<ToolMediaStore['findImage']>(() =>
      Promise.resolve({ kind: 'pdf' }),
    );
    const media: ToolMediaStore = {
      readImage: () => {
        throw new Error('stored PDFs do not decode as images');
      },
      findImage,
    };

    await expect(
      executeMediaRead(media, 'read', `media://${PDF_ID}`, undefined),
    ).resolves.toEqual({
      status: 'error',
      type: 'unsupported_media_type',
      message: 'PDF reads are not supported yet',
    });
    expect(findImage).toHaveBeenCalledWith(PDF_ID);
  });
});
