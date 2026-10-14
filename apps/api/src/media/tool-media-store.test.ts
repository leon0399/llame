import type { MediaService } from './media.service';
import { storedPdfRow } from './media-fixtures';
import { createToolMediaStore } from './tool-media-store';

const OWNER = 'owner';
const PDF_ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

describe('createToolMediaStore', () => {
  it('returns a PDF marker for an owned stored PDF', async () => {
    const findOwned = vi.fn<MediaService['findOwned']>(() =>
      Promise.resolve(storedPdfRow({ ownerUserId: OWNER, id: PDF_ID })),
    );
    const store = createToolMediaStore({ findOwned }, OWNER, new Map(), true);

    await expect(store.findImage(PDF_ID)).resolves.toEqual({ kind: 'pdf' });
    expect(findOwned).toHaveBeenCalledWith(OWNER, PDF_ID);
  });
});
