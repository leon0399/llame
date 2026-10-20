import {
  SSH_DIRECTORY_MAX_ENTRIES,
  SSH_DIRECTORY_TRANSFER_BYTES,
  SSH_LIST_MAX_ENTRIES,
  SSH_READ_TRANSFER_BYTES,
  buildSshBashScript,
  buildSshReadScript,
  createSshNonce,
  isSshReadRefusal,
  parseSshBashFrames,
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

    expect(script).toContain('  d=${p%/*}');
    expect(script).toContain(
      '  if [ -z "$d" ] || [ "$d" = "$p" ]; then d=/; fi',
    );
    expect(script).toContain('  if [ ! -e "$p" ]; then');
    expect(script).toContain('    a=$d');
    expect(script).toContain('    while [ ! -e "$a" ] && [ "$a" != / ]; do');
    expect(script).toContain('      a=${a%/*}');
    expect(script).toContain('      if [ -z "$a" ]; then a=/; fi');
    expect(script).toContain('    done');
    expect(script).toContain(
      '    if [ -d "$a" ] && [ ! -x "$a" ]; then refuse unreadable; fi',
    );
    expect(script).toContain('    refuse not_found');
    expect(script).toContain('refuse not_regular_file');
    expect(script).toContain('refuse unreadable');
    expect(script).toContain('head -c 1048577 -- "$p"');
    expect(script).toContain(String.raw`printf '%s:start:file\n'`);
    expect(script).toContain(String.raw`printf '%s:start:dir\n'`);
    expect(script).toContain('"$p"/* "$p"/.[!.]* "$p"/..?*');
    expect(script).toContain(
      `      if [ "$n" -ge ${String(SSH_DIRECTORY_MAX_ENTRIES)} ]; then break; fi`,
    );
    expect(script).toContain(String.raw`printf '%s:end:%s\n' "$h" "$s" >&2`);
  });

  it('sizes the directory transfer for every collected entry at its largest', () => {
    // A 255-byte name, its kind letter, and the two NULs that frame the pair.
    expect(SSH_DIRECTORY_MAX_ENTRIES).toBe(10_001);
    expect(SSH_DIRECTORY_TRANSFER_BYTES).toBe(
      SSH_DIRECTORY_MAX_ENTRIES * (255 + 1 + 2),
    );
    expect(SSH_DIRECTORY_TRANSFER_BYTES).toBeGreaterThan(2_500_000);
  });

  it('emits the exact wire script the host runs', () => {
    // The script is the host-side wire contract: every line is a statement the
    // hub parses back (markers, refusals, entry pairs). Pin it whole so a
    // dropped or reworded line cannot silently change the protocol.
    const expected = [
      '{',
      `  h='${NONCE}'`,
      `  p='/srv/a'`,
      '  refuse() {',
      String.raw`    printf '%s:refuse:%s\n' "$h" "$1" >&2`,
      String.raw`    printf '%s:end:0\n' "$h" >&2`,
      '    exit 0',
      '  }',
      '  d=${p%/*}',
      '  if [ -z "$d" ] || [ "$d" = "$p" ]; then d=/; fi',
      '  if [ ! -e "$p" ]; then',
      '    a=$d',
      '    while [ ! -e "$a" ] && [ "$a" != / ]; do',
      '      a=${a%/*}',
      '      if [ -z "$a" ]; then a=/; fi',
      '    done',
      '    if [ -d "$a" ] && [ ! -x "$a" ]; then refuse unreadable; fi',
      '    refuse not_found',
      '  fi',
      '  if [ -d "$p" ]; then',
      '    if [ ! -r "$p" ] || [ ! -x "$p" ]; then refuse unreadable; fi',
      String.raw`    printf '%s:start:dir\n' "$h"`,
      String.raw`    printf '%s:start\n' "$h" >&2`,
      '    n=0',
      '    for e in "$p"/* "$p"/.[!.]* "$p"/..?*; do',
      '      if [ ! -e "$e" ] && [ ! -L "$e" ]; then continue; fi',
      '      if [ -L "$e" ]; then k=l',
      '      elif [ -d "$e" ]; then k=d',
      '      elif [ -f "$e" ]; then k=f',
      '      else k=o',
      '      fi',
      '      name=${e##*/}',
      String.raw`      printf '%s\000%s\000' "$k" "$name"`,
      '      n=$((n + 1))',
      `      if [ "$n" -ge ${String(SSH_DIRECTORY_MAX_ENTRIES)} ]; then break; fi`,
      '    done',
      '  else',
      '    if [ ! -f "$p" ]; then refuse not_regular_file; fi',
      '    if [ ! -r "$p" ]; then refuse unreadable; fi',
      String.raw`    printf '%s:start:file\n' "$h"`,
      String.raw`    printf '%s:start\n' "$h" >&2`,
      `    head -c ${String(SSH_READ_TRANSFER_BYTES)} -- "$p"`,
      '  fi',
      '  s=$?',
      String.raw`  printf '%s:end:%s\n' "$h" "$s" >&2`,
      '}',
      '',
    ].join('\n');

    expect(buildSshReadScript({ nonce: NONCE, path: '/srv/a' })).toBe(expected);
  });
});

describe('isSshReadRefusal', () => {
  it('accepts the kinds this revision understands', () => {
    expect(isSshReadRefusal('not_found')).toBe(true);
    expect(isSshReadRefusal('not_regular_file')).toBe(true);
    expect(isSshReadRefusal('unreadable')).toBe(true);
  });

  it('refuses a kind from another revision', () => {
    expect(isSshReadRefusal('not_a_kind')).toBe(false);
    expect(isSshReadRefusal('')).toBe(false);
    expect(isSshReadRefusal('not_found ')).toBe(false);
  });
});

describe('buildSshBashScript', () => {
  it('enters the cwd first, exports the additions, then runs the command', () => {
    const script = buildSshBashScript({
      nonce: NONCE,
      cwd: '/srv/app',
      env: { TOKEN_HINT: "it's data" },
      command: 'printf "%s" "$TOKEN_HINT"',
    });

    expect(script.startsWith('{\n')).toBe(true);
    expect(script.endsWith('}\n')).toBe(true);
    expect(script).toContain(`p='/srv/app'`);
    expect(script).toContain('if ! cd -- "$p" 2>/dev/null; then');
    expect(script).toContain(String.raw`printf '%s:refuse:cwd\n' "$h" >&2`);
    expect(script).toContain(String.raw`export TOKEN_HINT='it'\''s data'`);
    expect(script.split('\n').filter((line) => /^[{}]$/u.test(line))).toEqual([
      '{',
      '}',
    ]);
    // The command is one single-quoted word after `eval`, run in a subshell
    // with an empty stdin, and the trailer carries that subshell's status.
    expect(script).toContain(
      `  ( eval 'printf "%s" "$TOKEN_HINT"' ) </dev/null`,
    );
    expect(script).toContain('  s=$?');
    expect(script).toContain(String.raw`printf '%s:end:%s\n' "$h" "$s" >&2`);
    expect(script.indexOf('export TOKEN_HINT')).toBeLessThan(
      script.indexOf(String.raw`printf '%s:start\n' "$h"`),
    );
  });

  it('keeps shell text in the command inside its single-quoted word', () => {
    const script = buildSshBashScript({
      nonce: NONCE,
      cwd: '/tmp',
      env: {},
      command: 'echo "a" && exit 255',
    });

    expect(script).toContain(`( eval 'echo "a" && exit 255' ) </dev/null`);
  });
});

describe('parseSshBashFrames', () => {
  it('keeps the command output after the marker and its stderr without the trailer', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`login banner\n${sshStartMarker(NONCE)}\ncommand out\n`),
      `login banner\n${sshStartMarker(NONCE)}\ncommand err\n${NONCE}:end:255\n`,
      NONCE,
    );

    expect(frames.started).toBe(true);
    expect(frames.stdout.toString()).toBe('command out\n');
    expect(frames.stderr).toBe('command err\n');
    expect(frames.status).toBe(255);
  });

  it('starts on the stderr marker when a failed process carried no stdout', () => {
    const frames = parseSshBashFrames(
      Buffer.alloc(0),
      `${sshStartMarker(NONCE)}\n`,
      NONCE,
    );

    expect(frames.started).toBe(true);
    expect(frames.status).toBeUndefined();
    expect(frames.stderr).toBe('');
  });

  it('reports a cwd refusal without a marker', () => {
    const frames = parseSshBashFrames(
      Buffer.alloc(0),
      `${NONCE}:refuse:cwd\n${NONCE}:end:0\n`,
      NONCE,
    );

    expect(frames.started).toBe(false);
    expect(frames.refusal).toBe('cwd');
    expect(frames.stderr).toBe('');
  });

  it('does not mistake login noise for output', () => {
    const frames = parseSshBashFrames(
      Buffer.from('login banner\n'),
      'login banner\n',
      NONCE,
    );

    expect(frames).toEqual({
      started: false,
      stdout: Buffer.alloc(0),
      stderr: '',
    });
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

  it('takes a bare marker as file content', () => {
    const frames = framesFrom(
      `${sshStartMarker(NONCE)}\nplain\n`,
      `${NONCE}:end:0\n`,
    );

    expect(frames.kind).toBe('file');
    expect(frames.content.toString()).toBe('plain\n');
  });

  it('leaves the kind unknown when the marker suffix is foreign', () => {
    const frames = framesFrom(
      `${sshStartMarker(NONCE)}:link\nbody\n`,
      `${NONCE}:end:0\n`,
    );

    expect(frames.started).toBe(true);
    expect('kind' in frames).toBe(false);
    expect(frames.content.toString()).toBe('body\n');
  });

  it('reads a marker that never ends its line', () => {
    const frames = parseSshReadFrames(
      Buffer.from(`${sshStartMarker(NONCE)}:`),
      `${NONCE}:end:0\n`,
      NONCE,
    );

    expect('kind' in frames).toBe(false);
    expect(frames.content.byteLength).toBe(0);
  });

  it('omits a refusal and a status the streams did not carry', () => {
    const noTrailer = framesFrom(`${sshStartMarker(NONCE)}:file\nx`, 'noise');
    expect('status' in noTrailer).toBe(false);

    const noRefusal = framesFrom('', 'noise');
    expect('refusal' in noRefusal).toBe(false);
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

  it('needs the marker itself, not only digits after it', () => {
    expect(parseSshTrailer('9'.repeat(64), NONCE)).toBeUndefined();
  });

  it('reads a trailer that starts away from the buffer start', () => {
    expect(parseSshTrailer(`x${NONCE}:end:5\n`, NONCE)).toBe(5);
  });

  it('reads the status digits only where the marker ends', () => {
    expect(parseSshTrailer(`${NONCE}:end:x7\n`, NONCE)).toBeUndefined();
    expect(parseSshTrailer(`${NONCE}:end:\n`, NONCE)).toBeUndefined();
  });

  it('reads a three-digit status whole', () => {
    expect(parseSshTrailer(`${NONCE}:end:123\n`, NONCE)).toBe(123);
  });

  it('reads a refusal that ends the buffer with no line end', () => {
    expect(parseSshRefusal(`${NONCE}:refuse:unreadable`, NONCE)).toBe(
      'unreadable',
    );
  });

  it('stops a refusal at its first line end', () => {
    expect(parseSshRefusal(`${NONCE}:refuse:a\nrest`, NONCE)).toBe('a');
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

  it('says there are more as soon as the hub bound is passed', () => {
    const field = Array.from(
      { length: SSH_LIST_MAX_ENTRIES + 1 },
      (_, index): string => `f\0f${String(index)}\0`,
    ).join('');

    const { entries, more } = parseSshDirectoryEntries(Buffer.from(field));

    // The parser keeps what the host sent: the caller sorts it and keeps the
    // local order's own bound.
    expect(entries).toHaveLength(SSH_LIST_MAX_ENTRIES + 1);
    expect(more).toBe(true);
  });

  it('keeps the bound itself as no more than the bound', () => {
    const field = Array.from(
      { length: SSH_LIST_MAX_ENTRIES },
      (_, index): string => `f\0f${String(index)}\0`,
    ).join('');

    const { entries, more } = parseSshDirectoryEntries(Buffer.from(field));

    expect(entries).toHaveLength(SSH_LIST_MAX_ENTRIES);
    expect(more).toBe(false);
  });

  it('keeps every entry a full transfer carries', () => {
    const field = Array.from(
      { length: SSH_DIRECTORY_MAX_ENTRIES },
      (_, index): string => `f\0f${String(index)}\0`,
    ).join('');

    const { entries, more } = parseSshDirectoryEntries(Buffer.from(field));

    expect(entries).toHaveLength(SSH_DIRECTORY_MAX_ENTRIES);
    expect(more).toBe(true);
  });

  it('names a special entry and skips a letter it does not know', () => {
    const { entries } = parseSshDirectoryEntries(
      Buffer.from('f\0file\0o\0device\0x\0junk\0'),
    );

    expect(entries).toEqual([
      { name: 'file', kind: 'file' },
      { name: 'device', kind: 'special' },
    ]);
  });

  it('ignores a trailing field with no name after it', () => {
    const { entries, more } = parseSshDirectoryEntries(Buffer.from('f\0a\0d'));

    expect(entries).toEqual([{ name: 'a', kind: 'file' }]);
    expect(more).toBe(false);
  });
});

describe('createSshNonce', () => {
  it('draws a new marker for every call', () => {
    expect(createSshNonce()).not.toBe(createSshNonce());
    expect(createSshNonce()).toMatch(/^[0-9a-f]{32}$/u);
  });
});
