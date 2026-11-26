//! Root enforcement: a path is served only when it, and where it resolves, lie
//! inside a registered root. Roots bound addressing; they are not a Sandbox.

use std::{
    fs, io,
    path::{Component, Path, PathBuf},
};

use tonic::Status;

use crate::refusal;

/// How many symbolic-link hops one resolution follows before refusing.
const MAX_LINK_DEPTH: u32 = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathKind {
    File,
    Directory,
    Other,
    Missing,
}

/// A path that passed root enforcement.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GuardedPath {
    /// The path as submitted, lexically normalised.
    pub path: PathBuf,
    /// Where it resolves; it may not exist yet.
    pub canonical: PathBuf,
    pub kind: PathKind,
    pub size: Option<u64>,
    pub is_link: bool,
}

#[derive(Clone, Debug)]
pub struct RootGuard {
    roots: Vec<PathBuf>,
}

/// `path` with `.` and `..` folded lexically. `..` above `/` stays at `/`.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::from("/");
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::ParentDir => {
                out.pop();
            }
            Component::RootDir | Component::CurDir | Component::Prefix(_) => {}
        }
    }
    out
}

/// Whether `target` is one of `roots` or lies below one.
pub fn is_inside(roots: &[PathBuf], target: &Path) -> bool {
    roots.iter().any(|root| target.starts_with(root))
}

fn is_absent(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::NotFound
        || error.raw_os_error() == Some(rustix::io::Errno::NOTDIR.raw_os_error())
}

/// The canonical location of `target`, which need not exist: the deepest
/// existing ancestor resolves as a whole and the missing suffix is appended;
/// a link at or above the missing part is followed by its own text.
fn canonical_target(target: &Path, depth: u32) -> Result<PathBuf, Status> {
    if depth > MAX_LINK_DEPTH {
        return Err(refusal::path_not_registered());
    }
    match fs::canonicalize(target) {
        Ok(path) => return Ok(path),
        Err(error) if is_absent(&error) => {}
        Err(_) => return Err(refusal::path_not_registered()),
    }
    let Some(parent) = target.parent() else {
        return Ok(target.to_path_buf());
    };
    let Some(name) = target.file_name() else {
        return Err(refusal::path_not_registered());
    };
    let is_link = fs::symlink_metadata(target).is_ok_and(|meta| meta.file_type().is_symlink());
    if is_link {
        let hop = fs::read_link(target).map_err(|_| refusal::path_not_registered())?;
        let next = if hop.is_absolute() {
            hop
        } else {
            canonical_target(parent, depth)?.join(hop)
        };
        return canonical_target(&next, depth + 1);
    }
    Ok(canonical_target(parent, depth)?.join(name))
}

impl RootGuard {
    pub fn new(roots: &[String]) -> Self {
        Self {
            roots: roots
                .iter()
                .map(|root| normalize(Path::new(root)))
                .collect(),
        }
    }

    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// The guarded form of `path`, or the fixed refusal. Call it again after an
    /// effect to re-verify that the address still resolves to the same place.
    pub fn resolve(&self, path: &str) -> Result<GuardedPath, Status> {
        if !path.starts_with('/') || path.contains('\0') {
            return Err(refusal::invalid_argument(
                "A Machine path must be an absolute POSIX path.",
            ));
        }
        let lexical = normalize(Path::new(path));
        if !is_inside(&self.roots, &lexical) {
            return Err(refusal::path_not_registered());
        }
        let canonical = canonical_target(&lexical, 0)?;
        if !is_inside(&self.roots, &canonical) {
            return Err(refusal::path_not_registered());
        }
        let is_link =
            fs::symlink_metadata(&lexical).is_ok_and(|meta| meta.file_type().is_symlink());
        let (kind, size) = match fs::metadata(&lexical) {
            Ok(meta) if meta.is_file() => (PathKind::File, Some(meta.len())),
            Ok(meta) if meta.is_dir() => (PathKind::Directory, Some(meta.len())),
            Ok(meta) => (PathKind::Other, Some(meta.len())),
            Err(_) => (PathKind::Missing, None),
        };
        Ok(GuardedPath {
            path: lexical,
            canonical,
            kind,
            size,
            is_link,
        })
    }

    /// Refuses when `path` no longer resolves to `before.canonical`.
    pub fn verify_unchanged(&self, before: &GuardedPath) -> Result<(), Status> {
        let after = self.resolve(&before.path.to_string_lossy())?;
        if after.canonical == before.canonical {
            Ok(())
        } else {
            Err(refusal::path_not_registered())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;

    fn guard(root: &Path) -> RootGuard {
        RootGuard::new(&[root.canonicalize().unwrap().to_string_lossy().into_owned()])
    }

    fn denied(result: Result<GuardedPath, Status>) -> bool {
        result.is_err_and(|status| status.code() == tonic::Code::PermissionDenied)
    }

    #[test]
    fn serves_inside_and_refuses_outside() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("a.txt"), "x").unwrap();
        let guard = guard(&root);
        let ok = guard
            .resolve(&root.join("a.txt").to_string_lossy())
            .unwrap();
        assert_eq!(ok.kind, PathKind::File);
        assert!(denied(guard.resolve("/etc/passwd")));
        assert!(denied(guard.resolve(&format!("{}/../x", root.display()))));
    }

    #[test]
    fn refuses_a_sibling_with_the_root_as_text_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        fs::create_dir(base.join("app")).unwrap();
        fs::create_dir(base.join("application")).unwrap();
        let guard = guard(&base.join("app"));
        assert!(denied(
            guard.resolve(&base.join("application/x").to_string_lossy())
        ));
    }

    #[test]
    fn refuses_links_out_including_dangling_ones() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let root = base.join("root");
        fs::create_dir(&root).unwrap();
        fs::write(base.join("secret"), "s").unwrap();
        symlink(base.join("secret"), root.join("out")).unwrap();
        symlink(base.join("missing/deeper"), root.join("dangling")).unwrap();
        symlink(root.join("inner.txt"), root.join("in")).unwrap();
        let guard = guard(&root);
        assert!(denied(guard.resolve(&root.join("out").to_string_lossy())));
        assert!(denied(
            guard.resolve(&root.join("dangling").to_string_lossy())
        ));
        assert!(denied(
            guard.resolve(&root.join("dangling/new.txt").to_string_lossy())
        ));
        let inner = guard.resolve(&root.join("in").to_string_lossy()).unwrap();
        assert_eq!(inner.kind, PathKind::Missing);
        assert!(inner.is_link);
    }
    #[test]
    fn resolves_parent_components_after_following_links() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::create_dir_all(outside.join("dir")).unwrap();
        symlink(outside.join("dir"), root.join("sub/link")).unwrap();
        symlink("sub/link/../x", root.join("relative")).unwrap();
        symlink(root.join("sub/link/../x"), root.join("absolute")).unwrap();
        let guard = guard(&root);

        assert!(denied(
            guard.resolve(&root.join("relative").to_string_lossy())
        ));
        assert!(denied(
            guard.resolve(&root.join("absolute").to_string_lossy())
        ));
    }

    #[test]
    fn refuses_relative_paths() {
        let guard = RootGuard::new(&["/".into()]);
        assert!(
            guard
                .resolve("relative")
                .is_err_and(|s| s.code() == tonic::Code::InvalidArgument)
        );
    }
}
