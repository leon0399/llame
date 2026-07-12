import { createDeltaBuffer } from './delta-buffer';

describe('createDeltaBuffer', () => {
  it('buffers below the threshold and coalesces once crossed', () => {
    const buffer = createDeltaBuffer(10);

    expect(buffer.push('abc')).toBeNull();
    expect(buffer.push('def')).toBeNull();
    // 3+3+4 = 10 chars — threshold crossed, everything so far comes out as one chunk.
    expect(buffer.push('ghij')).toBe('abcdefghij');
    // Buffer restarts empty after a flush.
    expect(buffer.push('k')).toBeNull();
  });

  it('flush drains the remainder and empties the buffer', () => {
    const buffer = createDeltaBuffer(100);

    buffer.push('tail');
    expect(buffer.flush()).toBe('tail');
    expect(buffer.flush()).toBeNull();
  });

  it('a single oversized push flushes immediately', () => {
    const buffer = createDeltaBuffer(5);

    expect(buffer.push('0123456789')).toBe('0123456789');
  });

  it('flushes by age when the buffer is old enough, even under the size threshold (#50 live streaming)', () => {
    const buffer = createDeltaBuffer(1000, 150);

    expect(buffer.push('Hel', 0)).toBeNull();
    expect(buffer.push('lo', 100)).toBeNull();
    // 160ms after the FIRST buffered char — age threshold crossed.
    expect(buffer.push('!', 160)).toBe('Hello!');
    // The age clock restarts with the next buffered char.
    expect(buffer.push('again', 200)).toBeNull();
    expect(buffer.push('!', 350)).toBe('again!');
  });

  it('without injected time, only size flushes apply (legacy pure mode)', () => {
    const buffer = createDeltaBuffer(1000, 150);

    expect(buffer.push('slow')).toBeNull();
    expect(buffer.push('tokens')).toBeNull();
    expect(buffer.flush()).toBe('slowtokens');
  });
});
