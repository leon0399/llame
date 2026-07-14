## MODIFIED Requirements

### Requirement: Project visibility and management surface

Projects SHALL be visible and manageable only to their owner, enforced in the datastore (defense-in-depth) and failing closed when the caller's identity is absent. The API SHALL expose project create/read/list/update/delete and chat filing as REST resources, each taking a validated request DTO and returning an explicit response type, deriving the acting identity only from the authenticated session (never from client-supplied ownership input), and surfacing authorization denials honestly rather than returning empty results. The project list SHALL honor the `?archived` and `?pinned` filter contract specified in `item-archive` (default list excludes archived and shows both pinned states; `?archived=with` includes archived, `?pinned=only` returns pinned projects, `?pinned=exclude` returns non-pinned). An archived project SHALL reject every update other than unarchive (`PATCH archived=false`) and delete (`DELETE`), refused with `409 Conflict`. A public/shared project SHALL remain viewable and forkable when archived.

#### Scenario: Listing projects returns only the caller's projects

- **WHEN** a user lists projects
- **THEN** the response contains exactly the projects they own, and no others

#### Scenario: The default project list excludes archived projects

- **WHEN** a user lists projects without `?archived`
- **THEN** archived projects are absent from the result

#### Scenario: Archived projects are surfaced by query param

- **WHEN** a user lists projects with `?archived=with`
- **THEN** archived projects are included in the response

#### Scenario: Pinned projects are filterable

- **WHEN** a user lists projects with `?pinned=only` or `?pinned=exclude`
- **THEN** the result contains only pinned or only non-pinned projects respectively

#### Scenario: A non-owner cannot see or manage a project

- **WHEN** a user requests, updates, or deletes a project they do not own
- **THEN** access is denied — the project is not returned and no change is made

#### Scenario: An archived project rejects edits but allows unarchive and delete

- **WHEN** a user renames an archived project they own
- **THEN** the request is refused with `409`; a `PATCH ... archived:false` or `DELETE` on that project succeeds

#### Scenario: A shared project stays viewable when archived

- **WHEN** a public/shared project is archived
- **THEN** its share link still returns the project (viewing and forking remain allowed)

#### Scenario: Identity is server-derived

- **WHEN** a request carries a client-supplied owner id that differs from the authenticated user
- **THEN** the server ignores the client-supplied identity and authorizes against the authenticated session
