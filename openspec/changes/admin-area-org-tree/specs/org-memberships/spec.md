## ADDED Requirements

### Requirement: Per-unit membership summary on the org-unit read surface

The org-unit list/tree read surface SHALL include, for each returned unit, a **member count** (the number of membership rows directly on that unit) and the requesting caller's **direct role** on that unit (the role from the caller's own membership row on the unit, or null when the caller has no direct membership there). These are a read-only summary derived from the existing `memberships` table — no new membership semantics, no datastore change. The caller's _inherited_ role (nearest-wins up the path) is not a new field; it is derivable client-side from the per-unit direct roles along the tree path.

Both fields SHALL respect **existing visibility rules**: the list returns the same units the caller can already see (role on the unit's path, or the creator-bootstrap edge), and the membership rows counted are those the caller's existing roster visibility exposes — the summary widens nothing.

#### Scenario: List returns member count and the caller's direct role

- **WHEN** a caller lists org units they can see
- **THEN** each unit carries its member count and the caller's direct role on it (null when the caller has no direct membership on that unit)

#### Scenario: Summary honors existing visibility

- **WHEN** a unit is not visible to the caller under the existing org-unit visibility rules
- **THEN** it does not appear in the list, and no member count or role for it is exposed

#### Scenario: Direct vs inherited is distinguishable

- **WHEN** the caller has a direct role on an ancestor but none on a descendant unit
- **THEN** the descendant's `directRole` is null (the inherited role is computed from the ancestor's direct role client-side, not returned as the descendant's own)
