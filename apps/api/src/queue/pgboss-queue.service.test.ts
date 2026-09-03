/**
 * Regression guard for a SILENT dependency-injection failure (#196).
 *
 * The `search:*` operator commands boot this DI graph through
 * `npx tsx src/search/operations/cli.ts`. tsx compiles with esbuild, which
 * does NOT implement `emitDecoratorMetadata` — so `design:paramtypes` is
 * absent at runtime no matter what `tsconfig.json` says.
 *
 * A constructor that relies on type-based injection therefore receives
 * `undefined` for that parameter, and Nest raises NO resolution error: the
 * provider constructs "successfully" and dies later on first use. The
 * observed symptom was `Cannot read properties of undefined (reading 'boss')`
 * repeated once per chat, with `backfill` reporting 458 failures and zero
 * enqueues.
 *
 * `@Inject(TOKEN)` records `self:paramtypes`, which esbuild preserves because
 * it is written by the decorator itself rather than synthesised from types.
 * Asserting on that metadata — not on behavior — is what makes this test
 * independent of the runtime it happens to execute under: it fails if anyone
 * drops the explicit token, even when running under a toolchain whose
 * metadata emission would have masked the bug.
 */

import 'reflect-metadata';

import { PgBossService } from '@wavezync/nestjs-pgboss';

import { isRecord } from '../unknown-record';
import { PgBossQueueService } from './pgboss-queue.service';

/** What `@Inject(TOKEN)` accepts: a class, a string, or a symbol. */
type InjectionToken =
  | string
  | symbol
  | (abstract new (...args: Array<never>) => object);

/** What `@Inject()` writes: one entry per decorated constructor parameter. */
type SelfParamType = { index: number; param: InjectionToken };

function isInjectionToken(value: unknown): value is InjectionToken {
  return (
    typeof value === 'function' ||
    typeof value === 'string' ||
    typeof value === 'symbol'
  );
}

function isSelfParamType(value: unknown): value is SelfParamType {
  return (
    isRecord(value) &&
    typeof value.index === 'number' &&
    isInjectionToken(value.param)
  );
}

/** A Nest provider class, i.e. what `@Injectable()` decorates. */
type ProviderClass = abstract new (...args: Array<never>) => object;

/**
 * Narrows `Reflect.getMetadata`'s `unknown` without asserting: an absent or
 * malformed entry must read as "not decorated" and fail the expectation,
 * never throw or be silently coerced into a passing shape.
 */
function selfParamTypesOf(target: ProviderClass): Array<SelfParamType> {
  const metadata: unknown = Reflect.getMetadata('self:paramtypes', target);
  if (!Array.isArray(metadata)) return [];
  return metadata.filter(isSelfParamType);
}

describe('PgBossQueueService dependency injection', () => {
  it('injects PgBossService by explicit token, not by type metadata', () => {
    const injected = selfParamTypesOf(PgBossQueueService);

    expect(injected.length).toBeGreaterThan(0);
    expect(injected.some((p) => p.param === PgBossService)).toBe(true);
  });

  it('does not depend on design:paramtypes, which esbuild never emits', () => {
    // Every constructor parameter must be covered by an explicit token, so the
    // provider resolves identically with or without emitted type metadata.
    const decorated = new Set(
      selfParamTypesOf(PgBossQueueService).map((p) => p.index),
    );

    for (let index = 0; index < PgBossQueueService.length; index++) {
      expect(decorated.has(index)).toBe(true);
    }
  });
});
