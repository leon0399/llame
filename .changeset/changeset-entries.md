---
---

- Record changelog entries as `.changeset/*.md` files instead of editing
  `CHANGELOG.md`, so parallel pull requests no longer conflict on it.
  `pnpm changelog:compile` moves shipped entries into `CHANGELOG.md` in a
  separate pull request and holds back entries of OpenSpec changes that are
  still active. The `CHANGELOG.md` merge driver is deleted; GitHub never ran
  it, and locally it fell back to a text merge whenever an existing entry
  changed. Run `git config --unset merge.changelog.driver` in an existing
  clone.
