import { placeListingSelector, renderListing } from './listing-window';
import { type ToolResult } from './types';

const refuse = (): ToolResult => ({
  status: 'error',
  type: 'invalid_selector',
  message: 'refused',
});

const render = (entries: Array<string>, selector?: string) =>
  renderListing('x://', entries, selector, {
    emptyContent: 'x://: empty\n',
    refuse,
  });

describe('renderListing', () => {
  it('prints the whole listing when it fits', () => {
    const result = render(['a', 'b', 'c']);

    expect(result).toMatchObject({
      status: 'success',
      content: 'x://\na\nb\nc\n',
      entryCount: 3,
      truncated: false,
    });
    expect(result).not.toHaveProperty('nextOffset');
  });

  it('prints the empty text for no entry', () => {
    expect(render([])).toMatchObject({
      content: 'x://: empty\n',
      entryCount: 0,
      truncated: false,
    });
  });

  it('cuts a window and names where the next page starts', () => {
    expect(render(['a', 'b', 'c'], '1-2')).toMatchObject({
      content: 'x://\na\nb\n',
      truncated: true,
      nextOffset: 2,
    });
  });

  it('is not truncated when the window reaches the last entry', () => {
    const result = render(['a', 'b', 'c'], '2-3');

    expect(result).toMatchObject({ content: 'x://\nb\nc\n', truncated: false });
    expect(result).not.toHaveProperty('nextOffset');
  });

  it('answers a refused selector with the caller refusal', () => {
    expect(render(['a'], 'raw')).toMatchObject({ message: 'refused' });
    expect(render(['a'], '1,3')).toMatchObject({ message: 'refused' });
  });
});

describe('placeListingSelector', () => {
  it('places a single range against the requested level', () => {
    expect(placeListingSelector('x://', '2-3', 5)).toMatchObject({
      window: { offset: 1, limit: 2 },
    });
  });

  it('refuses a comma request before it names a merged window', () => {
    expect(placeListingSelector('x://', '1,3', 5)).toStrictEqual({
      refusal: { kind: 'range' },
    });
  });

  it('names an outline request as its own kind', () => {
    expect(placeListingSelector('x://', 'outline', 5)).toStrictEqual({
      refusal: { kind: 'outline' },
    });
  });

  it('keeps the applier wording for a selector it judged', () => {
    expect(placeListingSelector('x://', 'L-5', 5)).toStrictEqual({
      refusal: {
        kind: 'invalid',
        message: 'Write -L5 for the last 5 lines, or L1-5 for the first 5.',
      },
    });
  });
});
