## ADDED Requirements

### Requirement: Project locators match their canonical logical identity

For Project locators, permission projection MUST use the resource grammar of `project-discovery`. It MUST lowercase the scheme and UUID, normalize the root alias, and remove read selectors. It MUST perform no filesystem or executor probe. Workspace projection MUST NOT change the locator. A permitted Project read MUST grant no permission for locations in its result.

#### Scenario: Case and selectors cannot bypass a reject

- **WHEN** the `read` group rejects `projects://<uuid>` and a call uses an uppercase scheme and UUID with `:raw:1-5`
- **THEN** the same canonical Project resource matches the reject
- **AND** no content access occurs

#### Scenario: Root aliases share one decision

- **WHEN** `read` receives `projects:///` or `PROJECTS://`
- **THEN** both match permission rules as `projects://`

#### Scenario: A returned location needs independent admission

- **WHEN** an admitted Project detail returns `machine://nas/srv/api`
- **THEN** subsequent file access or Workspace entry uses its own existing permission decision
- **AND** the Project read grants no Machine authority
