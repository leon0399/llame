/**
 * Product-identity tests (openspec/changes/opencode-go-provider, design D6 and
 * task 2.4): llame's version is read from the API package manifest, and a
 * manifest the boot read cannot use fails as an `InstanceConfigError` naming
 * the logical deployment requirement — never the resolved host path.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import { isRecord, isString } from '@workspace/runtime-safety';
import { loadProductUserAgent } from './product-identity';

/** Narrows a `catch`-clause `unknown` to its message without a cast; fails the test loudly if the caught value is not an `Error`. */
function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    throw new Error(`expected an Error instance, got ${String(err)}`);
  }
  return err.message;
}

/** A host path no deployment should ever disclose in a boot diagnostic. */
const CANARY_HOST_PATH = '/canary-host-layout/llame/apps/api/package.json';

/** An absolute path anywhere in a message: at its start or after whitespace. */
const HOST_ABSOLUTE_PATH = /(?:^|\s)\//u;

/**
 * Substitutes the manifest contents behind the module's own read seam
 * (anti-slop/no-module-mocking): production never passes one.
 */
function manifestText(text: string) {
  return { readFile: () => text };
}

/**
 * A manifest the deployed process cannot read: the fs error it produces
 * quotes the resolved absolute path, exactly as `ENOENT` does.
 */
function unreadableManifest() {
  return {
    readFile: () => {
      throw Object.assign(
        new Error(
          `ENOENT: no such file or directory, open '${CANARY_HOST_PATH}'`,
        ),
        { code: 'ENOENT' },
      );
    },
  };
}

describe('product identity — the version the manifest beside the module declares', () => {
  it('reads the API package manifest itself, so the identity tracks the deployment rather than a hardcoded version', () => {
    const manifestPath = path.resolve(__dirname, '..', '..', 'package.json');
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const version = isRecord(manifest) ? manifest.version : undefined;
    if (!isString(version)) {
      throw new Error('expected the API package manifest to declare a version');
    }

    expect(loadProductUserAgent()).toBe(`llame/${version}`);
  });

  it('renders the product token and the manifest version as one unmodified token', () => {
    const userAgent = loadProductUserAgent(manifestText('{"version":"9.9.9"}'));

    expect(userAgent).toBe('llame/9.9.9');
  });
});

describe('product identity — a manifest boot cannot use fails startup', () => {
  it('wraps an unreadable manifest as InstanceConfigError naming the logical requirement, never the resolved host path a boot log would disclose', () => {
    try {
      loadProductUserAgent(unreadableManifest());
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InstanceConfigError);
      const message = errorMessage(error);
      expect(message).toContain(
        'apps/api/package.json must be deployed beside dist/',
      );
      expect(message).toContain('missing, unreadable, or not valid JSON');
      expect(message).not.toContain(CANARY_HOST_PATH);
      expect(message).not.toMatch(HOST_ABSOLUTE_PATH);
    }
  });

  it('fails the same way when the manifest is not valid JSON', () => {
    try {
      loadProductUserAgent(manifestText('{"version": }'));
      expect.unreachable('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InstanceConfigError);
      const message = errorMessage(error);
      expect(message).toContain(
        'apps/api/package.json must be deployed beside dist/',
      );
      expect(message).toContain('missing, unreadable, or not valid JSON');
      expect(message).not.toMatch(HOST_ABSOLUTE_PATH);
    }
  });

  it('fails the same way when the manifest declares no non-blank version, rather than falling back to a generic name', () => {
    for (const manifest of [
      '{}',
      '[]',
      '{"version":""}',
      '{"version":"   "}',
      '{"version":1}',
      '{"version":null}',
    ]) {
      try {
        loadProductUserAgent(manifestText(manifest));
        expect.unreachable('expected throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceConfigError);
        const message = errorMessage(error);
        expect(message).toContain(
          'apps/api/package.json must be deployed beside dist/',
        );
        expect(message).toContain('declares none');
        expect(message).not.toMatch(HOST_ABSOLUTE_PATH);
      }
    }
  });
});
