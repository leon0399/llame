/**
 * Isolation, constraint, and cascade tests for project repository links, their
 * per-executor defaults, and the chat creation record, at the SQL boundary.
 *
 * The connecting role is the non-superuser, table-owning `app` role the
 * integration global setup provisions, so a green run proves FORCE ROW LEVEL
 * SECURITY constrains even the owner — the worst case for a self-hosted
 * deployment. Requires TEST_DATABASE_URL (the integration project sets it).
 *
 * Covers openspec `chat-start-location` — "Project repository links are
 * owner-isolated", "A project links repositories with an alias and a primary
 * link", "Project repository links are deleted with the project", and "A
 * project can have a default executor"; and `tool-call-permissions` — "Chat-
 * creation path decisions are recorded with the chat".
 */

import postgres, { type Sql } from 'postgres';

/* The postgres.js tagged template returns `any` rows; these tests assert on
   the raw SQL boundary on purpose, as `projects-rls.integration.test.ts` does. */
/* eslint-disable @typescript-eslint/no-unsafe-return */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = Sql;

describeIfDb('RLS integration — project repository links', () => {
  let sql: SqlClient;
  let userA: string;
  let userB: string;

  const asUser = <T>(userId: string, fn: (tx: SqlClient) => Promise<T>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  async function seedProject(owner: string): Promise<string> {
    const id = crypto.randomUUID();
    await asUser(
      owner,
      (tx) =>
        tx`INSERT INTO projects (id, owner_user_id, name) VALUES (${id}, ${owner}, 'Project')`,
    );
    return id;
  }

  async function seedRepository(owner: string): Promise<string> {
    const id = crypto.randomUUID();
    await asUser(
      owner,
      (tx) =>
        tx`INSERT INTO repositories (id, owner_user_id, display_name) VALUES (${id}, ${owner}, 'llame')`,
    );
    return id;
  }

  async function seedCheckout(
    owner: string,
    repositoryId: string,
    executorId = 'host',
  ): Promise<string> {
    const id = crypto.randomUUID();
    await asUser(
      owner,
      (tx) =>
        tx`INSERT INTO checkouts (id, owner_user_id, repository_id, executor_id, path, kind, branch, origin)
           VALUES (${id}, ${owner}, ${repositoryId}, ${executorId}, ${`/srv/${id}`}, 'main', 'master', 'registered')`,
    );
    return id;
  }

  async function seedLink(
    owner: string,
    projectId: string,
    repositoryId: string,
    isPrimary = false,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await asUser(
      owner,
      (tx) =>
        tx`INSERT INTO project_repositories (id, owner_user_id, project_id, repository_id, alias, is_primary)
           VALUES (${id}, ${owner}, ${projectId}, ${repositoryId}, 'llame', ${isPrimary})`,
    );
    return id;
  }

  async function seedDefault(
    owner: string,
    linkId: string,
    checkoutId: string,
    executorId = 'host',
  ): Promise<string> {
    const id = crypto.randomUUID();
    await asUser(
      owner,
      (tx) =>
        tx`INSERT INTO project_repository_defaults (id, owner_user_id, project_repository_id, executor_id, checkout_id)
           VALUES (${id}, ${owner}, ${linkId}, ${executorId}, ${checkoutId})`,
    );
    return id;
  }

  async function countAs(
    owner: string,
    run: (tx: SqlClient) => Promise<Array<{ count: number }>>,
  ): Promise<number> {
    const rows = await asUser(owner, run);
    return Number(rows[0].count);
  }

  beforeAll(async () => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = postgres(TEST_DB_URL!, { ssl, max: 2 });

    userA = crypto.randomUUID();
    userB = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userA}, 'Link A', ${`link-a-${userA}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userB}, 'Link B', ${`link-b-${userB}@test.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userA}, ${userB})`;
      await sql.end();
    }
  });

  it('the harness is meaningful: every table is ENABLED and FORCED', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('project_repositories', 'project_repository_defaults', 'chat_creation_records')
      ORDER BY relname`;
    expect(rows.map((row) => row.relname)).toEqual([
      'chat_creation_records',
      'project_repositories',
      'project_repository_defaults',
    ]);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it("owner B reads none of owner A's links or defaults", async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    const checkout = await seedCheckout(userA, repository);
    const link = await seedLink(userA, project, repository, true);
    await seedDefault(userA, link, checkout);

    expect(
      await countAs(
        userA,
        (tx) => tx`SELECT count(*)::int FROM project_repositories`,
      ),
    ).toBe(1);
    expect(
      await countAs(
        userB,
        (tx) => tx`SELECT count(*)::int FROM project_repositories`,
      ),
    ).toBe(0);
    expect(
      await countAs(
        userB,
        (tx) => tx`SELECT count(*)::int FROM project_repository_defaults`,
      ),
    ).toBe(0);
  });

  it("owner B's UPDATE and DELETE affect 0 rows on owner A's rows", async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    const checkout = await seedCheckout(userA, repository);
    const link = await seedLink(userA, project, repository);
    const defaults = await seedDefault(userA, link, checkout);

    const updatedLinks = await asUser(
      userB,
      (tx) =>
        tx`UPDATE project_repositories SET alias = 'stolen' WHERE id = ${link} RETURNING id`,
    );
    const deletedLinks = await asUser(
      userB,
      (tx) =>
        tx`DELETE FROM project_repositories WHERE id = ${link} RETURNING id`,
    );
    const updatedDefaults = await asUser(
      userB,
      (tx) =>
        tx`UPDATE project_repository_defaults SET executor_id = 'stolen' WHERE id = ${defaults} RETURNING id`,
    );
    const deletedDefaults = await asUser(
      userB,
      (tx) =>
        tx`DELETE FROM project_repository_defaults WHERE id = ${defaults} RETURNING id`,
    );
    const updatedProject = await asUser(
      userB,
      (tx) =>
        tx`UPDATE projects SET default_executor_id = 'stolen' WHERE id = ${project} RETURNING id`,
    );

    expect(updatedLinks).toHaveLength(0);
    expect(deletedLinks).toHaveLength(0);
    expect(updatedDefaults).toHaveLength(0);
    expect(deletedDefaults).toHaveLength(0);
    expect(updatedProject).toHaveLength(0);

    const [linkRow] = await asUser(
      userA,
      (tx) => tx`SELECT alias FROM project_repositories WHERE id = ${link}`,
    );
    expect(linkRow.alias).toBe('llame');
  });

  it("an INSERT naming another owner's owner id fails with 42501", async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);

    await expect(
      asUser(
        userB,
        (tx) =>
          tx`INSERT INTO project_repositories (owner_user_id, project_id, repository_id, alias)
             VALUES (${userB}, ${project}, ${repository}, 'llame')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      asUser(
        userB,
        (tx) =>
          tx`INSERT INTO projects (owner_user_id, name) VALUES (${userA}, 'Forged')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      asUser(userB, (tx) => tx`SELECT * FROM projects WHERE id = ${project}`),
    ).resolves.toHaveLength(0);
  });

  it("a link naming another owner's repository fails with 23503", async () => {
    const project = await seedProject(userA);
    const foreignRepository = await seedRepository(userB);

    await expect(
      asUser(
        userA,
        (tx) =>
          tx`INSERT INTO project_repositories (owner_user_id, project_id, repository_id, alias)
             VALUES (${userA}, ${project}, ${foreignRepository}, 'llame')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it("a defaults row naming another owner's checkout fails with 23503", async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    const link = await seedLink(userA, project, repository);
    const foreignRepository = await seedRepository(userB);
    const foreignCheckout = await seedCheckout(userB, foreignRepository);

    await expect(
      asUser(
        userA,
        (tx) =>
          tx`INSERT INTO project_repository_defaults (owner_user_id, project_repository_id, executor_id, checkout_id)
             VALUES (${userA}, ${link}, 'host', ${foreignCheckout})`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('one project holds one primary link and one isolation value', async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    const other = await seedRepository(userA);
    await seedLink(userA, project, repository, true);

    await expect(
      asUser(
        userA,
        (tx) =>
          tx`INSERT INTO project_repositories (owner_user_id, project_id, repository_id, alias, is_primary)
             VALUES (${userA}, ${project}, ${other}, 'other', true)`,
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      asUser(
        userA,
        (tx) =>
          tx`UPDATE project_repositories SET isolation = 'sometimes' WHERE project_id = ${project}`,
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // A non-primary duplicate of the same repository is still one row.
    await expect(
      asUser(
        userA,
        (tx) =>
          tx`INSERT INTO project_repositories (owner_user_id, project_id, repository_id, alias)
             VALUES (${userA}, ${project}, ${repository}, 'again')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('one link stores one default per executor and stamps every write', async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    const link = await seedLink(userA, project, repository);
    const host = await seedCheckout(userA, repository);
    const second = await seedCheckout(userA, repository);
    const nas = await seedCheckout(userA, repository, 'machine:nas');

    const defaults = await seedDefault(userA, link, host);
    await expect(
      asUser(
        userA,
        (tx) =>
          tx`INSERT INTO project_repository_defaults (owner_user_id, project_repository_id, executor_id, checkout_id)
             VALUES (${userA}, ${link}, 'host', ${second})`,
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const before = await asUser(
      userA,
      (tx) =>
        tx<
          Array<{ updated_at: Date }>
        >`SELECT updated_at FROM project_repository_defaults WHERE id = ${defaults}`,
    );
    await asUser(
      userA,
      (tx) =>
        tx`UPDATE project_repository_defaults SET checkout_id = ${second}, updated_at = now() + interval '1 second' WHERE id = ${defaults}`,
    );
    const after = await asUser(
      userA,
      (tx) =>
        tx<
          Array<{ checkout_id: string; updated_at: Date }>
        >`SELECT checkout_id, updated_at FROM project_repository_defaults WHERE id = ${defaults}`,
    );

    expect(after[0].checkout_id).toBe(second);
    expect(after[0].updated_at.getTime()).toBeGreaterThan(
      before[0].updated_at.getTime(),
    );

    // A second executor keeps its own row.
    await seedDefault(userA, link, nas, 'machine:nas');
    const rows = await asUser(
      userA,
      (tx) =>
        tx`SELECT executor_id FROM project_repository_defaults WHERE project_repository_id = ${link} ORDER BY executor_id`,
    );
    expect(rows.map((row) => row.executor_id)).toEqual(['host', 'machine:nas']);
  });

  it('deleting a project removes its links and defaults, keeps its chats and catalog', async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    const checkout = await seedCheckout(userA, repository);
    const link = await seedLink(userA, project, repository);
    await seedDefault(userA, link, checkout);
    const chat = crypto.randomUUID();
    await asUser(
      userA,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, project_id) VALUES (${chat}, ${userA}, ${project})`,
    );

    await asUser(userA, (tx) => tx`DELETE FROM projects WHERE id = ${project}`);

    expect(
      await countAs(
        userA,
        (tx) =>
          tx`SELECT count(*)::int FROM project_repositories WHERE project_id = ${project}`,
      ),
    ).toBe(0);
    expect(
      await countAs(
        userA,
        (tx) =>
          tx`SELECT count(*)::int FROM project_repository_defaults WHERE project_repository_id = ${link}`,
      ),
    ).toBe(0);
    const [filed] = await asUser(
      userA,
      (tx) => tx`SELECT project_id FROM chats WHERE id = ${chat}`,
    );
    expect(filed.project_id).toBeNull();
    expect(
      await countAs(
        userA,
        (tx) =>
          tx`SELECT count(*)::int FROM repositories WHERE id = ${repository}`,
      ),
    ).toBe(1);
    expect(
      await countAs(
        userA,
        (tx) => tx`SELECT count(*)::int FROM checkouts WHERE id = ${checkout}`,
      ),
    ).toBe(1);
  });

  it('deleting a repository removes its links; deleting a checkout removes its defaults', async () => {
    const firstProject = await seedProject(userA);
    const secondProject = await seedProject(userA);
    const repository = await seedRepository(userA);
    const checkout = await seedCheckout(userA, repository);
    const firstLink = await seedLink(userA, firstProject, repository);
    const secondLink = await seedLink(userA, secondProject, repository);
    await seedDefault(userA, firstLink, checkout);

    await asUser(
      userA,
      (tx) => tx`DELETE FROM checkouts WHERE id = ${checkout}`,
    );

    expect(
      await countAs(
        userA,
        (tx) =>
          tx`SELECT count(*)::int FROM project_repository_defaults WHERE project_repository_id = ${firstLink}`,
      ),
    ).toBe(0);

    await asUser(
      userA,
      (tx) => tx`DELETE FROM repositories WHERE id = ${repository}`,
    );

    expect(
      await countAs(
        userA,
        (tx) =>
          tx`SELECT count(*)::int FROM project_repositories WHERE id IN (${firstLink}, ${secondLink})`,
      ),
    ).toBe(0);
    expect(
      await countAs(
        userA,
        (tx) =>
          tx`SELECT count(*)::int FROM projects WHERE id IN (${firstProject}, ${secondProject})`,
      ),
    ).toBe(2);
  });

  it('one chat holds one creation record, isolated and cascaded', async () => {
    const chat = crypto.randomUUID();
    await asUser(
      userA,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id) VALUES (${chat}, ${userA})`,
    );
    await asUser(
      userA,
      (tx) =>
        tx`INSERT INTO chat_creation_records (owner_user_id, chat_id, attempts)
           VALUES (${userA}, ${chat}, '[{"decisions": [], "created_at": "2026-10-24T00:00:00.000Z"}]'::jsonb)`,
    );

    await expect(
      asUser(
        userA,
        (tx) =>
          tx`INSERT INTO chat_creation_records (owner_user_id, chat_id) VALUES (${userA}, ${chat})`,
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      asUser(
        userA,
        (tx) =>
          tx`UPDATE chat_creation_records SET attempts = '{}'::jsonb WHERE chat_id = ${chat}`,
      ),
    ).rejects.toMatchObject({ code: '23514' });

    expect(
      await asUser(
        userB,
        (tx) =>
          tx`SELECT attempts FROM chat_creation_records WHERE chat_id = ${chat}`,
      ),
    ).toHaveLength(0);

    await asUser(userA, (tx) => tx`DELETE FROM chats WHERE id = ${chat}`);
    expect(
      await countAs(
        userA,
        (tx) =>
          tx`SELECT count(*)::int FROM chat_creation_records WHERE chat_id = ${chat}`,
      ),
    ).toBe(0);
  });
});
