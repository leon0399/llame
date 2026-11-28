---
"machine": minor
"api": minor
"@workspace/native-file-tools": minor
---

- `grep` on the host and on a Machine no longer enters `.jj`, `.hg`, `.svn`,
  or `node_modules` directories, at any depth, in addition to `.git`. These
  directories never appear in `ignored`, even when a `.gitignore` names them.
  A scope that names one of them still searches it. Update every Machine
  daemon with this release; a daemon that is not updated keeps searching
  them.
- A directory read on the host or a Machine renders `.git`, `.jj`, `.hg`,
  `.svn`, and `node_modules` with no entries below them, and omits entries that
  an `.ignore` or `.gitignore` rule excludes. Reading such a directory by its
  own path still lists it. A `kb://` listing renders the same five names
  without entries below them.
