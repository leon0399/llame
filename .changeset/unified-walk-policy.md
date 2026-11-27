---
"machine": minor
---

- `grep` on the host and on a Machine no longer enters `.jj`, `.hg`, `.svn`,
  or `node_modules` directories, at any depth, in addition to `.git`. These
  directories never appear in `ignored`, even when a `.gitignore` names them.
  A scope that names one of them still searches it. Update every Machine
  daemon with this release; a daemon that is not updated keeps searching
  them.
