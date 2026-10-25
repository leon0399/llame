/**
 * Isolation, constraint, and cascade tests for project repository links at the
 * SQL boundary.
 *
 * The connecting role is the non-superuser, table-owning `app` role the
 * integration global setup provisions, so a green run proves FORCE ROW LEVEL
 * SECURITY constrains even the owner — the worst case for a self-hosted
 * deployment. Requires TEST_DATABASE_URL (the integration project sets it).
 *
 * Covers openspec `projects` — "Project repository links are owner-isolated", "A project links repositories with an alias and a primary
 * link", and "Project repository links are deleted with the project".
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

  it('the harness is meaningful: the table is ENABLED and FORCED', async () => {
    const [role] =
      await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);

    const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('project_repositories')
      ORDER BY relname`;
    expect(rows.map((row) => row.relname)).toEqual(['project_repositories']);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it("owner B reads none of owner A's links", async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    await seedLink(userA, project, repository, true);

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
  });

  it("owner B's UPDATE and DELETE affect 0 rows on owner A's rows", async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    const link = await seedLink(userA, project, repository);

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

    expect(updatedLinks).toHaveLength(0);
    expect(deletedLinks).toHaveLength(0);

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

  it('deleting a project removes its links, keeps its chats and catalog', async () => {
    const project = await seedProject(userA);
    const repository = await seedRepository(userA);
    const checkout = await seedCheckout(userA, repository);
    await seedLink(userA, project, repository);
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

  it('deleting a repository removes its links', async () => {
    const firstProject = await seedProject(userA);
    const secondProject = await seedProject(userA);
    const repository = await seedRepository(userA);
    const firstLink = await seedLink(userA, firstProject, repository);
    const secondLink = await seedLink(userA, secondProject, repository);

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
});
