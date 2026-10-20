import {
  SSH_LIST_MAX_ENTRIES,
  buildSshReadScript,
  createSshNonce,
  parseSshDirectoryEntries,
  parseSshReadFrames,
  parseSshRefusal,
  parseSshTrailer,
  shellQuote,
  sshStartMarker,
} from './ssh-script';

const NONCE = '0123456789abcdef0123456789abcdef';

function framesFrom(stdout: string, stderr: string) {
  return parseSshReadFrames(Buffer.from(stdout), stderr, NONCE);
}

describe('buildSshReadScript', () => {
  it('runs one group whose only arguments are single-quoted values', () => {
    const script = buildSshReadScript({
      nonce: NONCE,
      path: "/srv/it's here",
    });

    expect(script.startsWith('{\n')).toBe(true);
    expect(script.endsWith('}\n')).toBe(true);
    expect(script).toContain(`h='${NONCE}'`);
    expect(script).toContain(String.raw`p='/srv/it'\''s here'`);
    // The group is the whole script: the shell parses it before running it.
    expect(script.split('\n').filter((line) => /^[{}]$/u.test(line))).toEqual([
      '{',
      '}',
    ]);
  });

  it('checks the preconditions before it starts, and transfers bounded content', () => {
    const script = buildSshReadScript({ nonce: NONCE, path: '/etc/hostname' });

    expect(script).toContain('if [ ! -e "$p" ]; then refuse not_found; fi');
    expect(script).toContain('refuse not_regular_file');
    expect(script).toContain('refuse unreadable');
    expect(script).toContain('head -c 1048577 -- "$p"');
    expect(script).toContain(String.raw`printf '%s:start:file\n'`);
    expect(script).toContain(String.raw`printf '%s:start:dir\n'`);
    expect(script).toContain('"$p"/* "$p"/.[!.]* "$p"/..?*');
    expect(script).toContain(String.raw`printf '%s:end:%s\n' "$h" "$s" >&2`);
  });
});

describe('shellQuote', () => {
  it('keeps a quote inside the word instead of ending it', () => {
    expect(shellQuote("a'b")).toBe(String.raw`'a'\''b'`);
  });
});

describe('parseSshReadFrames', () => {
  it('discards everything before the start marker', () => {
    const frames = framesFrom(
      `login banner\n${sshStartMarker(NONCE)}:file\nfile bytes\n`,
      `${sshStartMarker(NONCE)}\n${NONCE}:end:0\n`,
    );

    expect(frames.started).toBe(true);
    expect(frames.kind).toBe('file');
    expect(frames.content.toString()).toBe('file bytes\n');
    expect(frames.status).toBe(0);
  });

  it('keeps the content byte-exact, including NUL and invalid UTF-8', () => {
    const bytes = Buffer.from([0x61, 0x00, 0xc3, 0x28, 0x0a]);
    const stdout = Buffer.concat([
      Buffer.from(`${sshStartMarker(NONCE)}:file\n`),
      bytes,
    ]);

    const frames = parseSshReadFrames(stdout, `${NONCE}:end:0\n`, NONCE);

    expect(frames.content.equals(bytes)).toBe(true);
  });

  it('reads a directory marker', () => {
    const frames = framesFrom(
      `${sshStartMarker(NONCE)}:dir\nd\0a\0`,
      `${NONCE}:end:0\n`,
    );

    expect(frames.kind).toBe('dir');
    expect(frames.content.toString()).toBe('d\0a\0');
  });

  it('reports a start marker with no end trailer as incomplete', () => {
    const frames = framesFrom(`${sshStartMarker(NONCE)}:file\ntext`, 'noise\n');

    expect(frames.started).toBe(true);
    expect(frames.status).toBeUndefined();
  });

  it('reads the stderr marker when a failed process carried no stdout', () => {
    const frames = parseSshReadFrames(
      Buffer.alloc(0),
      `noise\n${sshStartMarker(NONCE)}\n`,
      NONCE,
    );

    expect(frames.started).toBe(true);
    expect(frames.status).toBeUndefined();
  });

  it('does not mistake noise for a marker', () => {
    const frames = framesFrom('login banner\n', `${NONCE}:end:0\n`);

    expect(frames.started).toBe(false);
    expect(frames.content.byteLength).toBe(0);
  });

  it('carries a refusal without a marker', () => {
    const frames = framesFrom(
      '',
      `${NONCE}:refuse:not_found\n${NONCE}:end:0\n`,
    );

    expect(frames.started).toBe(false);
    expect(frames.refusal).toBe('not_found');
  });
});

describe('parseSshTrailer and parseSshRefusal', () => {
  it('takes the last trailer, so shell noise cannot shadow it', () => {
    expect(
      parseSshTrailer(`${NONCE}:end:1\nlater\n${NONCE}:end:7\n`, NONCE),
    ).toBe(7);
  });

  it('reads a refusal kind up to the line end', () => {
    expect(parseSshRefusal(`x\n${NONCE}:refuse:unreadable\nrest`, NONCE)).toBe(
      'unreadable',
    );
  });

  it('is absent when the frames never arrived', () => {
    expect(parseSshTrailer('nothing here', NONCE)).toBeUndefined();
    expect(parseSshRefusal('nothing here', NONCE)).toBeUndefined();
  });
});

describe('parseSshDirectoryEntries', () => {
  it('keeps a name with a newline one entry', () => {
    const { entries, more } = parseSshDirectoryEntries(
      Buffer.from('f\0two\nlines.txt\0d\0sub\0l\0link\0'),
    );

    expect(more).toBe(false);
    expect(entries).toEqual([
      { name: 'two\nlines.txt', kind: 'file' },
      { name: 'sub', kind: 'directory' },
      { name: 'link', kind: 'symlink' },
    ]);
  });

  it('stops one entry past the bound and says there are more', () => {
    const field = Array.from(
      { length: SSH_LIST_MAX_ENTRIES + 1 },
      (_, index): string => `f\0f${String(index)}\0`,
    ).join('');

    const { entries, more } = parseSshDirectoryEntries(Buffer.from(field));

    expect(entries).toHaveLength(SSH_LIST_MAX_ENTRIES);
    expect(more).toBe(true);
  });
});

describe('createSshNonce', () => {
  it('draws a new marker for every call', () => {
    expect(createSshNonce()).not.toBe(createSshNonce());
    expect(createSshNonce()).toMatch(/^[0-9a-f]{32}$/u);
  });
});
