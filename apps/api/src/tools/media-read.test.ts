import type { ToolMediaStore } from '../media/tool-media-store';
import { executeMediaRead } from './media-read';

const ID = '0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';

function store(findImage: ToolMediaStore['findImage']): ToolMediaStore {
  return {
    readImage: () => () => Promise.reject(new Error('not an unstored read')),
    findImage,
  };
}

describe('executeMediaRead', () => {
  // Interim guard (pdf-media pdf-store until pdf-read).
  it('refuses a stored PDF as unsupported_media_type', async () => {
    const media = store(() =>
      Promise.resolve({ kind: 'pdf', media: `media://${ID}` }),
    );

    await expect(
      executeMediaRead(media, 'read', `media://${ID}`, undefined),
    ).resolves.toEqual({
      status: 'error',
      type: 'unsupported_media_type',
      message: 'PDF reads are not supported yet',
    });
  });
});
