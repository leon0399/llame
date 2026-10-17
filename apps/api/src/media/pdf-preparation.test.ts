import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MEDIA_MAX_BYTES, MEDIA_REFUSAL } from './media-ingest';
import {
  BOUNDED_START,
  isPdfSignature,
  pdfParseChild,
  preparePdf,
} from './pdf-preparation';

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => vi.unstubAllEnvs());

const UNOPENABLE = {
  name: 'MediaIngestError',
  ...MEDIA_REFUSAL.unopenablePdf,
};
const TOO_LARGE = { name: 'MediaIngestError', ...MEDIA_REFUSAL.pdfTooLarge };
const UNAVAILABLE = {
  name: 'MediaIngestError',
  ...MEDIA_REFUSAL.pdfUnavailable,
};

const onLinux = process.platform === 'linux';
const hasPrlimit = onLinux && spawnSync('prlimit', ['--version']).status === 0;

function fixture(name: string): Buffer {
  return readFileSync(path.join(__dirname, 'testing', 'pdf', name));
}

/** A parse child running `node -e code` through the production start chain. */
function fakeEntry(code: string, timeoutMs = 10_000) {
  return pdfParseChild(['-e', code], timeoutMs);
}

/** A `%PDF-` body padded with spaces to `size` bytes. */
function paddedPdf(size: number): Buffer {
  const head = Buffer.from('%PDF-1.7\n');
  return Buffer.concat([head, Buffer.alloc(size - head.length, 0x20)]);
}

describe('isPdfSignature', () => {
  it('accepts bytes that start with %PDF-', () => {
    expect(isPdfSignature(Buffer.from('%PDF-1.7\n'))).toBe(true);
  });

  it('refuses a shorter or different head', () => {
    expect(isPdfSignature(Buffer.from('%PDF'))).toBe(false);
    expect(isPdfSignature(Buffer.from(' %PDF-1.7'))).toBe(false);
  });
});

describe('preparePdf', () => {
  it.each([
    ['one-page.pdf', 1],
    ['fifteen-pages.pdf', 15],
  ])('counts the pages of %s', async (name, pages) => {
    await expect(preparePdf(fixture(name))).resolves.toBe(pages);
  });

  it('refuses a missing compiled parser outside vitest', async () => {
    vi.stubEnv('VITEST', undefined);

    await expect(preparePdf(fixture('one-page.pdf'))).rejects.toMatchObject(
      UNAVAILABLE,
    );
  });

  it('refuses a truncated PDF', async () => {
    const input = fixture('one-page.pdf');

    await expect(
      preparePdf(input.subarray(0, input.length / 2)),
    ).rejects.toMatchObject(UNOPENABLE);
  });

  it('refuses %PDF- followed by garbage', async () => {
    await expect(
      preparePdf(Buffer.from('%PDF-1.7\nnot a document at all')),
    ).rejects.toMatchObject(UNOPENABLE);
  });

  it('refuses a PDF whose page tree counts zero pages', async () => {
    await expect(preparePdf(fixture('zero-pages.pdf'))).rejects.toMatchObject(
      UNOPENABLE,
    );
  });

  it('refuses a PDF over 100 pages', async () => {
    await expect(
      preparePdf(fixture('hundred-one-pages.pdf')),
    ).rejects.toMatchObject(TOO_LARGE);
  });
  it('accepts a PDF whose parser reports exactly 100 pages', async () => {
    const boundary = fakeEntry(
      'process.stdout.write(JSON.stringify({ pages: 100, encrypted: false }))',
    );

    await expect(preparePdf(fixture('one-page.pdf'), boundary)).resolves.toBe(
      100,
    );
  });

  it('refuses an input over 20 MiB before spawning a parser', async () => {
    const neverStarts = {
      command: path.join(__dirname, 'no-such-parse-child'),
      args: [],
      timeoutMs: 1000,
    };

    await expect(
      preparePdf(paddedPdf(21 * 1024 * 1024), neverStarts),
    ).rejects.toMatchObject(TOO_LARGE);
  });

  it.each([
    'owner-password.pdf',
    'user-password.pdf',
    'owner-password-no-p.pdf',
    'encrypt-text.pdf',
  ])('refuses %s as encrypted', async (name) => {
    await expect(preparePdf(fixture(name))).rejects.toMatchObject(UNOPENABLE);
  });

  it('refuses a PDF the parser reports as encrypted', async () => {
    const encrypted = fakeEntry(
      'process.stdout.write(JSON.stringify({ pages: 1, encrypted: true }))',
    );

    await expect(
      preparePdf(fixture('one-page.pdf'), encrypted),
    ).rejects.toMatchObject(UNOPENABLE);
  });

  it('refuses unparseable parser output', async () => {
    const garbled = fakeEntry('process.stdout.write("pages: 1")');

    await expect(
      preparePdf(fixture('one-page.pdf'), garbled),
    ).rejects.toMatchObject(UNOPENABLE);
  });
  it('refuses a nonzero parser exit even with valid output', async () => {
    const failed = fakeEntry(
      'process.stdout.write(JSON.stringify({ pages: 1, encrypted: false })); process.exitCode = 1;',
    );

    await expect(
      preparePdf(fixture('one-page.pdf'), failed),
    ).rejects.toMatchObject(UNOPENABLE);
  });

  it('treats a bounded-start status with output as an unopenable PDF', async () => {
    const failedStart = fakeEntry(
      String.raw`process.stderr.write("bound failed\n"); process.stdout.write(JSON.stringify({ pages: 1, encrypted: false })); process.exitCode = 70;`,
    );

    await expect(
      preparePdf(fixture('one-page.pdf'), failedStart),
    ).rejects.toMatchObject(UNOPENABLE);
  });
  it('drains parser stderr while accepting its valid report', async () => {
    const noisy = fakeEntry(
      'process.stderr.write("x".repeat(1024 * 1024)); process.stdout.write(JSON.stringify({ pages: 1, encrypted: false }))',
      2000,
    );

    await expect(preparePdf(fixture('one-page.pdf'), noisy)).resolves.toBe(1);
  });

  it('leaves the caller buffer intact', async () => {
    const input = fixture('fifteen-pages.pdf');
    const before = Buffer.from(input);

    await preparePdf(input);

    expect(input.length).toBe(before.length);
    expect(input.equals(before)).toBe(true);
  });
});

describe('parse child entry', () => {
  // The TypeScript entry vitest runs; production runs its compiled twin.
  const entryArgs = [
    '--import',
    'tsx',
    path.join(__dirname, 'pdf-parse-entry.ts'),
  ];

  it('reports the permissions of an owner-password PDF', () => {
    const child = spawnSync(process.execPath, entryArgs, {
      cwd: __dirname,
      input: fixture('owner-password.pdf'),
    });

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout.toString())).toEqual({
      pages: 1,
      encrypted: true,
    });
  });

  it('exits 1 without output on a user-password PDF', () => {
    const child = spawnSync(process.execPath, entryArgs, {
      cwd: __dirname,
      input: fixture('user-password.pdf'),
    });

    expect(child.status).toBe(1);
    expect(child.stdout.toString()).toBe('');
  });
});

describe('parse child bounds', () => {
  it('kills a parser past its time bound while the parent keeps running', async () => {
    // Real time on purpose: the bound kills a real child process, and the
    // ticking interval proves the parent's event loop stayed free meanwhile.
    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
    }, 10);
    const started = performance.now();
    try {
      await expect(
        preparePdf(
          fixture('one-page.pdf'),
          fakeEntry('setTimeout(() => undefined, 60_000)', 500),
        ),
      ).rejects.toMatchObject(UNOPENABLE);
    } finally {
      clearInterval(interval);
    }

    expect(performance.now() - started).toBeLessThan(5000);
    expect(ticks).toBeGreaterThan(10);
  });

  it.runIf(onLinux)(
    'refuses a parser that exhausts its address space',
    async () => {
      // 3 GiB of untouched memory, then a hang: only the 2 GiB address-space
      // bound ends this child before its 5 s time bound.
      const allocating = fakeEntry(
        'const held = []; for (let i = 0; i < 48; i += 1) held.push(Buffer.allocUnsafeSlow(1 << 26)); setTimeout(() => undefined, 60_000);',
        5000,
      );
      const started = performance.now();

      await expect(
        preparePdf(fixture('one-page.pdf'), allocating),
      ).rejects.toMatchObject(UNOPENABLE);
      expect(performance.now() - started).toBeLessThan(3000);
      await expect(preparePdf(fixture('one-page.pdf'))).resolves.toBe(1);
    },
  );

  it.each([
    ['a small body', () => fixture('one-page.pdf')],
    ['a 20 MiB body', () => paddedPdf(MEDIA_MAX_BYTES)],
  ])('reports a start failure with %s as unavailable', async (_, body) => {
    const failingStart = {
      command: 'sh',
      args: ['-c', 'echo "ulimit: cannot apply" >&2; exit 70'],
      timeoutMs: 5000,
    };

    await expect(preparePdf(body(), failingStart)).rejects.toMatchObject(
      UNAVAILABLE,
    );
  });

  it('reports a parser that cannot be spawned as unavailable', async () => {
    const missing = {
      command: path.join(__dirname, 'no-such-parse-child'),
      args: [],
      timeoutMs: 5000,
    };

    await expect(
      preparePdf(fixture('one-page.pdf'), missing),
    ).rejects.toMatchObject(UNAVAILABLE);
  });

  it.runIf(hasPrlimit)(
    'starts a parser under an inherited hard limit below 2 GiB',
    () => {
      const { command, args } = fakeEntry(
        'process.stdout.write(\'{"pages":15,"encrypted":false}\')',
      );
      const child = spawnSync(
        'prlimit',
        ['--as=1610612736:1610612736', '--', command, ...args],
        { cwd: __dirname },
      );

      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout.toString())).toEqual({
        pages: 15,
        encrypted: false,
      });
    },
  );

  it.runIf(hasPrlimit)(
    'refuses to start under a hard limit below the V8 floor',
    () => {
      const child = spawnSync('prlimit', [
        '--as=1073741824:1073741824',
        '--',
        'sh',
        '-c',
        BOUNDED_START,
        'sh',
        process.execPath,
        '-e',
        '1',
      ]);

      expect(child.status).toBe(70);
      expect(child.stdout.toString()).toBe('');
    },
  );

  it('runs at most two parsers at once and settles every call', async () => {
    const liveDir = mkdtempSync(path.join(tmpdir(), 'pdf-parse-live-'));
    // Each child registers itself, waits, then reports how many were live.
    const counting = pdfParseChild([
      '-e',
      `const fs = require('node:fs');
       const mine = require('node:path').join(process.argv[1], String(process.pid));
       fs.writeFileSync(mine, '');
       setTimeout(() => {
         const live = fs.readdirSync(process.argv[1]).length;
         fs.unlinkSync(mine);
         process.stdout.write(JSON.stringify({ pages: live, encrypted: false }));
       }, 300);`,
      liveDir,
    ]);
    try {
      const input = fixture('one-page.pdf');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => preparePdf(input, counting)),
      );

      expect(results).toHaveLength(5);
      expect(Math.max(...results)).toBeLessThan(3);
    } finally {
      rmSync(liveDir, { recursive: true, force: true });
    }
  });
});
