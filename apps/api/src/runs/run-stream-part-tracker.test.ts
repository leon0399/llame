/**
 * The UI part registry of one streamed reply (text/streaming D3, reasoning
 * D8): which delivery continues an open part, which opens the next one, and
 * which part starts a `model.superseded` window may name. Unit tests for the
 * pure state machine behind the live bridge.
 */

import { StreamPartTracker } from './run-stream-part-tracker';

describe('StreamPartTracker', () => {
  it('reports no open part and no continuation before one begins', () => {
    const parts = new StreamPartTracker();

    expect(parts.open('text')).toBeUndefined();
    // A closed kind has nothing to continue, with or without an adapter id.
    expect(parts.continues('text', 'adapter-1')).toBe(false);
    expect(parts.continues('text', undefined)).toBe(false);
  });

  it('continues the open part under the same adapter id or an absent one', () => {
    const parts = new StreamPartTracker();

    parts.begin('text', 'adapter-1', 1);
    expect(parts.continues('text', 'adapter-1')).toBe(true);
    // An absent id is "no information", never a boundary.
    expect(parts.continues('text', undefined)).toBe(true);
    // Two defined ids that differ name different parts.
    expect(parts.continues('text', 'adapter-2')).toBe(false);
  });

  it('adopts a defined adapter id and ignores an absent one', () => {
    const parts = new StreamPartTracker();

    parts.begin('reasoning', 'wire-1', 1);
    // An absent id adds nothing: the remembered id still decides.
    parts.adopt('reasoning', undefined);
    expect(parts.continues('reasoning', 'wire-2')).toBe(false);
    // A defined id replaces it, so the delivery under it continues.
    parts.adopt('reasoning', 'wire-2');
    expect(parts.continues('reasoning', 'wire-2')).toBe(true);
  });

  it('closes the open part, reporting its UI id once', () => {
    const parts = new StreamPartTracker();

    const openId = parts.begin('text', 'adapter-1', 1);

    expect(parts.close('text')).toBe(openId);
    expect(parts.open('text')).toBeUndefined();
    expect(parts.close('text')).toBeUndefined();
    expect(parts.continues('text', 'adapter-1')).toBe(false);
  });

  it('counts UI ids per kind so each begins under its own id', () => {
    const parts = new StreamPartTracker();

    expect(parts.begin('text', undefined, 1)).toBe('text-1');
    expect(parts.begin('reasoning', undefined, 2)).toBe('reasoning-1');
    expect(parts.begin('text', undefined, 3)).toBe('text-2');
  });

  it('tracks only positive integer part starts inside a superseded window', () => {
    const parts = new StreamPartTracker();

    parts.begin('text', undefined, undefined);
    parts.begin('text', undefined, 0);
    parts.begin('text', undefined, 1.5);
    parts.begin('text', undefined, 1);
    parts.begin('text', undefined, 6);

    // Undefined, zero, and non-integer sequences cannot name a part.
    expect(parts.takeWindow(0, 5)).toEqual(['text-4']);
    // A named part is removed, so repeating the window invents nothing.
    expect(parts.takeWindow(0, 5)).toEqual([]);
    // `from` is inclusive and `to` exclusive.
    expect(parts.takeWindow(6, 7)).toEqual(['text-5']);
  });

  it('drops a step\u2019s part starts when the step ends', () => {
    const parts = new StreamPartTracker();

    parts.begin('text', undefined, 1);
    parts.begin('reasoning', undefined, 2);
    parts.clear();

    expect(parts.takeWindow(0, 10)).toEqual([]);
  });
});
