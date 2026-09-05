import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { resolveSearchScopes, type TimeRange } from './chats-search-scope';

const dialect = new PgDialect();
const compile = (fragment: SQL) => dialect.sqlToQuery(fragment);

const AFTER = new Date('2026-02-01T00:00:00.000Z');
const BEFORE = new Date('2026-03-01T00:00:00.000Z');

describe('resolveSearchScopes', () => {
  it('with no timeRange, scope stays the plain owner predicate and there is no range preference', () => {
    const { scope, rangePreference } = resolveSearchScopes('owner-1');

    const doc = compile(scope.document);
    expect(doc.sql).toBe('d.owner_user_id = $1');
    expect(doc.params).toStrictEqual(['owner-1']);

    const parent = compile(scope.parent);
    expect(parent.sql).toBe('c.owner_user_id = $1');
    expect(parent.params).toStrictEqual(['owner-1']);

    expect(rangePreference).toBeUndefined();
  });

  describe('constraint: "required"', () => {
    const range: TimeRange = {
      after: AFTER,
      before: BEFORE,
      constraint: 'required',
    };

    it('ANDs the document overlap range onto the owner predicate', () => {
      const { scope } = resolveSearchScopes('owner-1', range);
      const { sql: text, params } = compile(scope.document);

      expect(text).toBe(
        '(d.owner_user_id = $1 AND d.first_message_at < $2::timestamptz AND d.last_message_at >= $3::timestamptz)',
      );
      expect(params).toStrictEqual([
        'owner-1',
        BEFORE.toISOString(),
        AFTER.toISOString(),
      ]);
    });

    it('gates the parent predicate on an EXISTS over eligible in-range messages, carrying the identity guard', () => {
      const { scope } = resolveSearchScopes('owner-1', range);
      const { sql: text, params } = compile(scope.parent);

      expect(text).toContain('c.owner_user_id = $1');
      expect(text).toContain('EXISTS (');
      expect(text).toContain('em.chat_id = c.id');
      expect(text).toContain(
        "current_setting('app.current_user_id', true) = $2",
      );
      expect(text).toContain('"em".role');
      expect(text).toContain('em.created_at >= $3::timestamptz');
      expect(text).toContain('em.created_at < $4::timestamptz');
      expect(params).toStrictEqual([
        'owner-1',
        'owner-1',
        AFTER.toISOString(),
        BEFORE.toISOString(),
      ]);
    });

    it('applies exactly one clause for a one-sided document range', () => {
      const afterOnly = compile(
        resolveSearchScopes('owner-1', { after: AFTER, constraint: 'required' })
          .scope.document,
      );
      expect(afterOnly.sql).not.toContain('first_message_at');
      expect(afterOnly.sql).toContain('d.last_message_at >= $2::timestamptz');

      const beforeOnly = compile(
        resolveSearchScopes('owner-1', {
          before: BEFORE,
          constraint: 'required',
        }).scope.document,
      );
      expect(beforeOnly.sql).not.toContain('last_message_at');
      expect(beforeOnly.sql).toContain('d.first_message_at < $2::timestamptz');
    });

    it('applies exactly one clause for a one-sided parent EXISTS range', () => {
      const afterOnly = compile(
        resolveSearchScopes('owner-1', { after: AFTER, constraint: 'required' })
          .scope.parent,
      );
      expect(afterOnly.sql).toContain('em.created_at >= $3::timestamptz');
      expect(afterOnly.sql).not.toContain('em.created_at <');

      const beforeOnly = compile(
        resolveSearchScopes('owner-1', {
          before: BEFORE,
          constraint: 'required',
        }).scope.parent,
      );
      expect(beforeOnly.sql).toContain('em.created_at < $3::timestamptz');
      expect(beforeOnly.sql).not.toContain('em.created_at >=');
    });

    it('produces no range preference', () => {
      const { rangePreference } = resolveSearchScopes('owner-1', range);
      expect(rangePreference).toBeUndefined();
    });
  });

  describe('constraint: "preferred"', () => {
    const range: TimeRange = {
      after: AFTER,
      before: BEFORE,
      constraint: 'preferred',
    };

    it('never filters — scope stays the plain owner predicate', () => {
      const noRange = resolveSearchScopes('owner-1');
      const preferred = resolveSearchScopes('owner-1', range);

      expect(compile(preferred.scope.document)).toStrictEqual(
        compile(noRange.scope.document),
      );
      expect(compile(preferred.scope.parent)).toStrictEqual(
        compile(noRange.scope.parent),
      );
    });

    it('carries the overlap predicate and the fixed weight', () => {
      const { rangePreference } = resolveSearchScopes('owner-1', range);
      expect(rangePreference?.weight).toBe(0.25);

      const { sql: text, params } = compile(rangePreference!.predicate);
      expect(text).toBe(
        '(d.first_message_at < $1::timestamptz AND d.last_message_at >= $2::timestamptz)',
      );
      expect(params).toStrictEqual([BEFORE.toISOString(), AFTER.toISOString()]);
    });

    it('reduces to one clause for a one-sided range', () => {
      const { rangePreference } = resolveSearchScopes('owner-1', {
        after: AFTER,
        constraint: 'preferred',
      });
      const { sql: text } = compile(rangePreference!.predicate);
      expect(text).toBe('(d.last_message_at >= $1::timestamptz)');
    });

    it('is unconditionally true with neither bound present (a no-op bonus)', () => {
      const { rangePreference } = resolveSearchScopes('owner-1', {
        constraint: 'preferred',
      });
      const { sql: text, params } = compile(rangePreference!.predicate);
      expect(text).toBe('true');
      expect(params).toStrictEqual([]);
    });
  });
});
