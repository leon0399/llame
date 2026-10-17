import { storedPdfRow } from '../media-fixtures';
import { toMediaDescriptor } from './media.dto';

describe('toMediaDescriptor', () => {
  it('rejects a row with neither image columns nor a page count', () => {
    const malformed = storedPdfRow({ pageCount: null });

    expect(() => toMediaDescriptor(malformed)).toThrowError(Error);
  });
});
