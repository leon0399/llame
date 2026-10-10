import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { mediaBlobs, mediaObjects } from './index';

const dialect = new PgDialect();

function policies(table: typeof mediaObjects | typeof mediaBlobs) {
  return getTableConfig(table).policies.map((policy) => ({
    name: policy.name,
    for: policy.for,
    using:
      policy.using === undefined
        ? undefined
        : dialect.sqlToQuery(policy.using).sql.replaceAll(/\s+/gu, ' '),
    withCheck:
      policy.withCheck === undefined
        ? undefined
        : dialect.sqlToQuery(policy.withCheck).sql.replaceAll(/\s+/gu, ' '),
  }));
}

const OWNER = "owner_user_id = current_setting('app.current_user_id', true)";
const OWNED_MEDIA = `media_id IN ( SELECT id FROM media_objects WHERE ${OWNER} )`;

describe('media schema', () => {
  it('deduplicates media objects per owner digest', () => {
    const config = getTableConfig(mediaObjects);

    expect(config.enableRLS).toBe(true);
    expect(
      config.uniqueConstraints.map((constraint) => [
        constraint.name,
        constraint.columns.map((column) => column.name),
      ]),
    ).toEqual([
      ['media_objects_owner_sha256_unique', ['owner_user_id', 'sha256']],
    ]);
  });

  it('lets an owner only read and insert their own media objects', () => {
    expect(policies(mediaObjects)).toEqual([
      {
        name: 'media_objects_owner_select',
        for: 'select',
        using: OWNER,
        withCheck: undefined,
      },
      {
        name: 'media_objects_owner_insert',
        for: 'insert',
        using: undefined,
        withCheck: OWNER,
      },
    ]);
  });

  it('keys blobs by object and variant, visible only through an owned object', () => {
    const config = getTableConfig(mediaBlobs);

    expect(config.enableRLS).toBe(true);
    expect(
      config.primaryKeys.map((key) => key.columns.map((column) => column.name)),
    ).toEqual([['media_id', 'variant']]);
    expect(policies(mediaBlobs)).toEqual([
      {
        name: 'media_blobs_owner_select',
        for: 'select',
        using: OWNED_MEDIA,
        withCheck: undefined,
      },
      {
        name: 'media_blobs_owner_insert',
        for: 'insert',
        using: undefined,
        withCheck: OWNED_MEDIA,
      },
    ]);
  });
});
