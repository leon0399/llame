/**
 * The remote `bash` protocol: the exact script that travels on stdin and the
 * parsing of the frames it writes back. The script is asserted as a whole
 * because each line is part of the protocol — a dropped trailer or `exit`
 * changes what the host does, not just how the text looks.
 */
import {
  buildSshBashScript,
  parseSshBashFrames,
  shellQuote,
  sshStartMarker,
} from './ssh-script';

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const MARKER = sshStartMarker(NONCE);

describe('buildSshBashScript protocol', () => {
  it('writes the whole script, from the cd guard to the end trailer', () => {
    const script = buildSshBashScript({
      nonce: NONCE,
      cwd: '/srv/app',
      env: { TOKEN_HINT: "it's data" },
      command: 'printf "%s" "$TOKEN_HINT"',
    });

    expect(script).toBe(
      [
        '{',
        `  p=${shellQuote('/srv/app')}`,
        '  if ! cd -- "$p" 2>/dev/null; then',
        String.raw`    printf '%s:refuse:cwd\n' ${shellQuote(NONCE)} >&2`,
        String.raw`    printf '%s:end:0\n' ${shellQuote(NONCE)} >&2`,
        '    exit 0',
        '  fi',
        String.raw`  printf '%s:start\n' ${shellQuote(NONCE)}`,
        String.raw`  printf '%s:start\n' ${shellQuote(NONCE)} >&2`,
        String.raw`  ( export TOKEN_HINT='it'\''s data'; eval 'printf "%s" "$TOKEN_HINT"' ) </dev/null`,
        '  s=$?',
        String.raw`  printf '%s:end:%s\n' ${shellQuote(NONCE)} "$s" >&2`,
        '}',
        '',
      ].join('\n'),
    );
  });
});

describe('parseSshBashFrames stderr', () => {
  it('reports no command stderr when the marker is only on stdout', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`${MARKER}\ncommand out\n`),
      `${'n'.repeat(40)}\n${'m'.repeat(30)}\n${NONCE}:end:7\n`,
      NONCE,
    );

    expect(frames.started).toBe(true);
    expect(frames.stderr).toBe('');
    expect(frames.status).toBe(7);
  });

  it('finds the marker line even when it does not start the stream', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`${MARKER}\ncommand out\n`),
      `X${MARKER}\ncommand err\n${NONCE}:end:0\n`,
      NONCE,
    );

    expect(frames.stderr).toBe('command err\n');
  });

  it('takes the marker line by its newline, not by a guess at its length', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`${MARKER}\r\ncommand out\r\n`),
      `${MARKER}\r\ncommand err\r\n${NONCE}:end:0\r\n`,
      NONCE,
    );

    expect(frames.stderr).toBe('command err\r\n');
  });

  it('reports no command stderr when the marker line never ends', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`${MARKER}\ncommand out\n`),
      `${MARKER} trailing without a newline`,
      NONCE,
    );

    expect(frames.stderr).toBe('');
  });

  it('keeps everything after the marker when no trailer arrived', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`${MARKER}\ncommand out\n`),
      `${MARKER}\ncommand err\n`,
      NONCE,
    );

    expect(frames.stderr).toBe('command err\n');
  });

  it('reports empty command stderr when the trailer follows the marker line', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`${MARKER}\n`),
      `${MARKER}\n${NONCE}:end:0\n`,
      NONCE,
    );

    expect(frames).toStrictEqual({
      started: true,
      stdout: Buffer.alloc(0),
      stderr: '',
      status: 0,
    });
  });
});

describe('parseSshBashFrames stdout', () => {
  it('starts on the stdout marker even when stderr has no marker', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`${MARKER}\ncommand out\n`),
      '',
      NONCE,
    );

    expect(frames).toStrictEqual({
      started: true,
      stdout: Buffer.from('command out\n'),
      stderr: '',
    });
  });

  it('ends the stdout marker line at its own end, past login noise', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`${'x'.repeat(60)}\nnoise after the first line\n`),
      `${MARKER}\n${NONCE}:end:0\n`,
      NONCE,
    );

    expect(frames.started).toBe(true);
    expect(frames.stdout).toEqual(Buffer.alloc(0));
    expect(frames.status).toBe(0);
  });

  it('finds a stdout marker that does not start the stream', () => {
    const frames = parseSshBashFrames(
      Buffer.from(`X${MARKER}\ncommand out\n`),
      '',
      NONCE,
    );

    expect(frames.stdout.toString()).toBe('command out\n');
  });
});
