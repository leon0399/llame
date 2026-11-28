//! Seeds a new worktree with the source checkout's `.worktreeinclude` selection.
//!
//! Git decides which files qualify (ignored and untracked); the manifest, matched top-down as a
//! gitignore, decides which of those are copied. Every source and destination access goes through
//! directory handles opened one component at a time with `O_NOFOLLOW`, so a link can never
//! redirect a read or a write.

use super::{GitFailure, GitFailureReason, ProcessGroup, STDERR_MAX, git_command, read_capped};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use rustix::{
    fd::{AsFd, AsRawFd, OwnedFd},
    fs::{
        AtFlags, FileType, Mode, OFlags, fchmod, fstat, mkdirat, openat, renameat, statat, unlinkat,
    },
    io::Errno,
};
use std::{
    ffi::OsStr,
    fs::File,
    io::{Read, Write},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};
use tokio::{io::AsyncReadExt, time::timeout};

const MANIFEST: &str = ".worktreeinclude";
const MANIFEST_MAX: u64 = 1024 * 1024;
const CHUNK: usize = 64 * 1024;
const RECORD_MAX: usize = 64 * 1024;
const REPORTED_PATH_MAX: usize = 200;
static TEMPORARY: AtomicU64 = AtomicU64::new(0);

/// Why a seed stopped. `Failed` carries a fixed phrase and at most one relative path; nothing from
/// the OS, git, the manifest, or file contents ever reaches it.
#[derive(Debug)]
pub enum SeedError {
    Failed(&'static str, Option<Vec<u8>>),
    TimedOut,
}

impl SeedError {
    pub fn into_failure(self) -> GitFailure {
        match self {
            Self::TimedOut => super::failure(GitFailureReason::TimedOut, ""),
            Self::Failed(phrase, path) => {
                let message = path.map_or_else(
                    || phrase.to_owned(),
                    |path| {
                        let mut path = String::from_utf8_lossy(&path).into_owned();
                        let mut end = REPORTED_PATH_MAX.min(path.len());
                        while !path.is_char_boundary(end) {
                            end -= 1;
                        }
                        path.truncate(end);
                        format!("{phrase}: {path}")
                    },
                );
                GitFailure {
                    reason: GitFailureReason::CopyFailed as i32,
                    message,
                    stderr: String::new(),
                }
            }
        }
    }
}

const fn failed(phrase: &'static str) -> SeedError {
    SeedError::Failed(phrase, None)
}
fn failed_at(phrase: &'static str, path: &[u8]) -> SeedError {
    SeedError::Failed(phrase, Some(path.to_vec()))
}

/// Copies the selected files of `source` into `destination`, the literal requested path, within
/// `deadline`. The manifest is read and screened first, and the destination is bound only once
/// something is selected, so an absent or empty manifest never depends on the platform. A
/// destination whose real path differs from the requested one receives nothing and fails, so no
/// caller binds an unseeded Worktree.
pub async fn seed(source: &Path, destination: &Path, deadline: Instant) -> Result<(), SeedError> {
    let Some(source_root) = bind_root(source)? else {
        return Err(failed("copy source moved"));
    };
    let Some(matcher) = read_manifest(&source_root, source)? else {
        return Ok(());
    };
    let selected = enumerate(source, &matcher, deadline).await?;
    if selected.is_empty() {
        return Ok(());
    }
    let Some(destination_root) = bind_root(destination)? else {
        return Err(failed("worktree root moved"));
    };
    tokio::task::spawn_blocking(move || {
        for relative in &selected {
            if Instant::now() >= deadline {
                return Err(SeedError::TimedOut);
            }
            copy_file(&source_root, &destination_root, relative, deadline)?;
        }
        Ok(())
    })
    .await
    .map_err(|_| failed("copy was interrupted"))?
}

fn directory_flags() -> OFlags {
    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
}

/// Opens a checked root (the copy source or the new worktree) without following a link and requires
/// its real path to equal the checked one, so a component swapped after the check cannot redirect
/// reads or writes. `None` is a moved root; a root whose real path cannot be established fails.
fn bind_root(destination: &Path) -> Result<Option<OwnedFd>, SeedError> {
    let root = match rustix::fs::open(destination, directory_flags(), Mode::empty()) {
        Ok(root) => root,
        Err(rustix::io::Errno::LOOP | rustix::io::Errno::NOTDIR) => return Ok(None),
        Err(_) => return Err(failed("root cannot be opened")),
    };
    // ponytail: /proc/self/fd is Linux procfs; macOS would need F_GETPATH. Upgrade when the
    // daemon targets a non-Linux platform.
    let real = rustix::fs::readlink(format!("/proc/self/fd/{}", root.as_raw_fd()), Vec::new())
        .map_err(|_| failed("root cannot be resolved"))?;
    Ok((Path::new(OsStr::from_bytes(real.to_bytes())) == destination).then_some(root))
}

/// `None` for an absent manifest or one that holds no pattern.
fn read_manifest(root: &OwnedFd, source: &Path) -> Result<Option<Gitignore>, SeedError> {
    let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC;
    let fd = match openat(root, MANIFEST, flags, Mode::empty()) {
        Ok(fd) => fd,
        Err(Errno::NOENT) => return Ok(None),
        Err(Errno::LOOP) => return Err(failed("manifest is a symbolic link")),
        Err(_) => return Err(failed("manifest cannot be read")),
    };
    let regular =
        fstat(&fd).is_ok_and(|st| FileType::from_raw_mode(st.st_mode) == FileType::RegularFile);
    if !regular {
        return Err(failed("manifest is not a regular file"));
    }
    let mut bytes = Vec::new();
    File::from(fd)
        .take(MANIFEST_MAX + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| failed("manifest cannot be read"))?;
    if bytes.len() as u64 > MANIFEST_MAX {
        return Err(failed("manifest is too large"));
    }
    let text = String::from_utf8(bytes).map_err(|_| failed("manifest is not valid UTF-8"))?;
    parse_manifest(&text, source)
}

fn parse_manifest(text: &str, source: &Path) -> Result<Option<Gitignore>, SeedError> {
    if text.contains('\0') || text.lines().any(refused_pattern) {
        return Err(failed("manifest pattern is refused"));
    }
    let mut builder = GitignoreBuilder::new(source);
    for line in text.lines() {
        builder
            .add_line(None, line)
            .map_err(|_| failed("manifest pattern is invalid"))?;
    }
    let matcher = builder
        .build()
        .map_err(|_| failed("manifest pattern is invalid"))?;
    Ok((!matcher.is_empty()).then_some(matcher))
}

/// A pattern that names `..` or `.git` after its leading `!` and `/`. Git output never holds
/// such paths, so a wildcard is not refused; the screen stops explicit traversal.
fn refused_pattern(line: &str) -> bool {
    let pattern = line.trim_end_matches(' ');
    if pattern.starts_with('#') {
        return false;
    }
    let pattern = pattern.strip_prefix('!').unwrap_or(pattern);
    let pattern = pattern.strip_prefix('/').unwrap_or(pattern);
    pattern
        .split('/')
        .any(|segment| segment == ".." || segment == ".git")
}

/// Top-down evaluation: the first ignored ancestor selects the candidate and a later negation
/// cannot re-include it; otherwise the candidate's own match decides.
fn selected(matcher: &Gitignore, relative: &Path) -> bool {
    let mut ancestor = PathBuf::new();
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        ancestor.push(component);
        if components.peek().is_some() && matcher.matched(&ancestor, true).is_ignore() {
            return true;
        }
    }
    matcher.matched(relative, false).is_ignore()
}

/// Streams git's ignored, untracked listing and keeps only the selected paths. There is no
/// stdout cap; the deadline bounds it. The invocation is the pinned, hardened one.
async fn enumerate(
    source: &Path,
    matcher: &Gitignore,
    deadline: Instant,
) -> Result<Vec<Vec<u8>>, SeedError> {
    let args = [
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        "--exclude-standard",
    ];
    let (mut command, _hooks) =
        git_command(source, &args, true).map_err(|_| failed("ignored files cannot be listed"))?;
    let mut child = command
        .spawn()
        .map_err(|_| failed("ignored files cannot be listed"))?;
    let mut group = ProcessGroup(child.id().and_then(|id| i32::try_from(id).ok()));
    let (Some(mut stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        return Err(failed("ignored files cannot be listed"));
    };
    let drain = tokio::spawn(read_capped(stderr, STDERR_MAX));
    let remaining = || deadline.saturating_duration_since(Instant::now());
    let mut chosen = Vec::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut buffer = vec![0; CHUNK];
    loop {
        let read = match timeout(remaining(), stdout.read(&mut buffer)).await {
            Err(_) => return Err(SeedError::TimedOut),
            Ok(Err(_)) => return Err(failed("ignored files cannot be listed")),
            Ok(Ok(read)) => read,
        };
        if read == 0 {
            break;
        }
        pending.extend_from_slice(&buffer[..read]);
        while let Some(end) = pending.iter().position(|byte| *byte == 0) {
            let record: Vec<u8> = pending.drain(..=end).collect();
            let record = &record[..end];
            if !record.is_empty()
                && !record.ends_with(b"/")
                && selected(matcher, Path::new(OsStr::from_bytes(record)))
            {
                chosen.push(record.to_vec());
            }
        }
        if pending.len() > RECORD_MAX {
            return Err(failed("ignored files cannot be listed"));
        }
    }
    let status = timeout(remaining(), child.wait()).await;
    drain.abort();
    if status.is_ok() {
        group.0 = None;
    }
    match status {
        Err(_) => Err(SeedError::TimedOut),
        Ok(Ok(status)) if status.success() && pending.is_empty() => Ok(chosen),
        Ok(_) => Err(failed("ignored files cannot be listed")),
    }
}

/// A destination-local temporary file, removed unless it was renamed into place.
struct Temporary {
    directory: OwnedFd,
    name: String,
    armed: bool,
}

impl Drop for Temporary {
    fn drop(&mut self) {
        if self.armed {
            let _ = unlinkat(&self.directory, self.name.as_str(), AtFlags::empty());
        }
    }
}

fn walk(
    root: &OwnedFd,
    components: &[&[u8]],
    create: bool,
    relative: &[u8],
) -> Result<OwnedFd, SeedError> {
    let mut current = root
        .try_clone()
        .map_err(|_| failed_at("directory cannot be opened", relative))?;
    for component in components {
        if create {
            match mkdirat(&current, *component, Mode::from_raw_mode(0o777)) {
                Ok(()) | Err(Errno::EXIST) => {}
                Err(_) => {
                    return Err(failed_at(
                        "destination directory cannot be created",
                        relative,
                    ));
                }
            }
        }
        current = openat(&current, *component, directory_flags(), Mode::empty()).map_err(|_| {
            if create {
                failed_at("destination path conflicts", relative)
            } else {
                failed_at("source path is not a plain directory", relative)
            }
        })?;
    }
    Ok(current)
}

fn check_destination(directory: &OwnedFd, name: &[u8], relative: &[u8]) -> Result<(), SeedError> {
    match statat(directory, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(st) if FileType::from_raw_mode(st.st_mode) == FileType::RegularFile => Ok(()),
        Ok(_) => Err(failed_at("destination is not a regular file", relative)),
        Err(Errno::NOENT) => Ok(()),
        Err(_) => Err(failed_at("destination cannot be inspected", relative)),
    }
}

fn copy_file(
    source_root: &OwnedFd,
    destination_root: &OwnedFd,
    relative: &[u8],
    deadline: Instant,
) -> Result<(), SeedError> {
    let mut components: Vec<&[u8]> = relative.split(|byte| *byte == b'/').collect();
    if components
        .iter()
        .any(|part| part.is_empty() || *part == b"." || *part == b".." || *part == b".git")
    {
        return Err(failed_at("candidate path is invalid", relative));
    }
    let Some(name) = components.pop() else {
        return Err(failed_at("candidate path is invalid", relative));
    };
    let source_directory = walk(source_root, &components, false, relative)?;
    let flags =
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::NOCTTY | OFlags::CLOEXEC;
    let source_fd = match openat(&source_directory, name, flags, Mode::empty()) {
        Ok(fd) => fd,
        Err(Errno::LOOP) => return Err(failed_at("source is a symbolic link", relative)),
        Err(Errno::NOENT) => return Err(failed_at("source file is missing", relative)),
        Err(_) => return Err(failed_at("source file cannot be read", relative)),
    };
    let stat = fstat(&source_fd).map_err(|_| failed_at("source file cannot be read", relative))?;
    if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile {
        return Err(failed_at("source is not a regular file", relative));
    }
    let destination_directory = walk(destination_root, &components, true, relative)?;
    check_destination(&destination_directory, name, relative)?;
    let temporary_name = format!(
        ".llame-seed-{}-{}",
        std::process::id(),
        TEMPORARY.fetch_add(1, Ordering::Relaxed)
    );
    let mut temporary = Temporary {
        directory: destination_directory
            .try_clone()
            .map_err(|_| failed_at("destination file cannot be created", relative))?,
        name: temporary_name,
        armed: false,
    };
    let temporary_fd = openat(
        &destination_directory,
        temporary.name.as_str(),
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::from_raw_mode(0o600),
    )
    .map_err(|_| failed_at("destination file cannot be created", relative))?;
    temporary.armed = true;
    let mut input = File::from(source_fd);
    let mut output = File::from(temporary_fd);
    let mut buffer = vec![0; CHUNK];
    loop {
        if Instant::now() >= deadline {
            return Err(SeedError::TimedOut);
        }
        let read = input
            .read(&mut buffer)
            .map_err(|_| failed_at("source file cannot be read", relative))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|_| failed_at("destination file cannot be written", relative))?;
    }
    fchmod(output.as_fd(), Mode::from_raw_mode(stat.st_mode & 0o777))
        .map_err(|_| failed_at("destination file cannot be written", relative))?;
    drop(output);
    check_destination(&destination_directory, name, relative)?;
    renameat(
        &destination_directory,
        temporary.name.as_str(),
        &destination_directory,
        name,
    )
    .map_err(|_| failed_at("destination file cannot be replaced", relative))?;
    temporary.armed = false;
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{MetadataExt, PermissionsExt, symlink},
        time::Duration,
    };

    fn matcher(lines: &[&str]) -> Gitignore {
        parse_manifest(&lines.join("\n"), Path::new("/source"))
            .unwrap()
            .unwrap()
    }
    fn picks(matcher: &Gitignore, path: &str) -> bool {
        selected(matcher, Path::new(path))
    }

    // The three recorded matcher probes.
    #[test]
    fn generic_pattern_selects_a_file_under_an_ignored_directory() {
        let matcher = matcher(&["**/config.json"]);
        assert!(picks(&matcher, "vendor/pkg/config.json"));
        assert!(!picks(&matcher, "vendor/pkg/other.json"));
    }
    #[test]
    fn glob_negation_excludes_one_file() {
        let matcher = matcher(&["secrets/**", "!secrets/private.json"]);
        assert!(picks(&matcher, "secrets/public.json"));
        assert!(!picks(&matcher, "secrets/private.json"));
    }
    #[test]
    fn directory_pattern_keeps_a_child_despite_its_negation() {
        let matcher = matcher(&["secrets/", "!secrets/private.json"]);
        assert!(picks(&matcher, "secrets/private.json"));
        assert!(picks(&matcher, "secrets/deep/x.json"));
    }

    #[test]
    fn comments_escapes_anchors_and_order_follow_gitignore() {
        let matcher = matcher(&[
            "# comment",
            "",
            "\\#literal",
            "/root.env",
            "*.key",
            "!keep.key",
            "build/",
        ]);
        assert!(picks(&matcher, "#literal"));
        assert!(picks(&matcher, "root.env"));
        assert!(!picks(&matcher, "sub/root.env"));
        assert!(picks(&matcher, "a/b/x.key"));
        assert!(!picks(&matcher, "keep.key"));
        assert!(picks(&matcher, "build/out/file"));
        assert!(!picks(&matcher, "comment"));
    }

    #[test]
    fn unsafe_patterns_are_refused_before_parsing() {
        for text in [
            "../secret",
            "/.git/config",
            "!a/.git/b",
            "a/../b",
            "ok\0bad",
        ] {
            assert!(
                matches!(
                    parse_manifest(text, Path::new("/source")),
                    Err(SeedError::Failed("manifest pattern is refused", None))
                ),
                "{text:?}"
            );
        }
        for text in ["*", "# ../comment", "", "\n\n", ".gitignore", "a..b"] {
            assert!(
                parse_manifest(text, Path::new("/source")).is_ok(),
                "{text:?}"
            );
        }
    }

    #[test]
    fn manifest_without_patterns_selects_nothing() {
        for text in ["", "\n  \n", "# only a comment\n"] {
            assert!(
                parse_manifest(text, Path::new("/source"))
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[test]
    fn failure_message_is_a_fixed_phrase_and_one_bounded_path() {
        let failure = SeedError::Failed(
            "source file cannot be read",
            Some(b"config/secret.env".to_vec()),
        )
        .into_failure();
        assert_eq!(failure.reason, GitFailureReason::CopyFailed as i32);
        assert_eq!(
            failure.message,
            "source file cannot be read: config/secret.env"
        );
        assert!(failure.stderr.is_empty());
        let long = SeedError::Failed("x", Some("é".repeat(500).into_bytes())).into_failure();
        assert!(long.message.len() <= 3 + REPORTED_PATH_MAX);
        assert_eq!(
            SeedError::TimedOut.into_failure().reason,
            GitFailureReason::TimedOut as i32
        );
    }

    struct Fixture {
        _temp: tempfile::TempDir,
        source: PathBuf,
        destination: PathBuf,
        outside: PathBuf,
    }
    fn fixture() -> Fixture {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let (source, destination, outside) = (
            base.join("source"),
            base.join("destination"),
            base.join("outside"),
        );
        for path in [&source, &destination, &outside] {
            fs::create_dir_all(path).unwrap();
        }
        Fixture {
            _temp: temp,
            source,
            destination,
            outside,
        }
    }
    fn init_repository(path: &Path) {
        let status = std::process::Command::new("git")
            .arg("init")
            .arg("-q")
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success());
    }
    fn copy(fixture: &Fixture, relative: &str) -> Result<(), SeedError> {
        let source = rustix::fs::open(&fixture.source, directory_flags(), Mode::empty()).unwrap();
        let destination = bind_root(&fixture.destination).unwrap().unwrap();
        copy_file(
            &source,
            &destination,
            relative.as_bytes(),
            Instant::now() + Duration::from_secs(30),
        )
    }
    fn assert_no_temporary(directory: &Path) {
        for entry in fs::read_dir(directory).unwrap() {
            let name = entry.unwrap().file_name();
            assert!(
                !name.to_string_lossy().starts_with(".llame-seed-"),
                "{name:?}"
            );
        }
    }

    #[test]
    fn copies_bytes_and_ordinary_mode_but_never_set_id() {
        let f = fixture();
        fs::create_dir_all(f.source.join("config")).unwrap();
        fs::write(f.source.join("config/.env"), b"SECRET=1\n").unwrap();
        fs::set_permissions(
            f.source.join("config/.env"),
            fs::Permissions::from_mode(0o4750),
        )
        .unwrap();
        copy(&f, "config/.env").unwrap();
        let copied = f.destination.join("config/.env");
        assert_eq!(fs::read(&copied).unwrap(), b"SECRET=1\n");
        assert_eq!(fs::metadata(&copied).unwrap().mode() & 0o7777, 0o750);
        assert_no_temporary(&f.destination.join("config"));
    }

    #[test]
    fn selected_symlink_is_refused_without_reading_its_target() {
        let f = fixture();
        fs::write(f.outside.join("secret"), b"SYNTHETIC-MARKER").unwrap();
        symlink(f.outside.join("secret"), f.source.join(".env")).unwrap();
        let failure = copy(&f, ".env").unwrap_err().into_failure();
        assert_eq!(failure.message, "source is a symbolic link: .env");
        assert!(!f.destination.join(".env").exists());
    }

    #[test]
    fn symlink_parent_in_the_source_is_not_traversed() {
        let f = fixture();
        fs::write(f.outside.join("x.env"), b"SYNTHETIC-MARKER").unwrap();
        symlink(&f.outside, f.source.join("linked")).unwrap();
        assert!(copy(&f, "linked/x.env").is_err());
        assert!(!f.destination.join("linked").exists());
    }

    #[test]
    fn special_file_is_refused_without_blocking() {
        let f = fixture();
        assert!(
            std::process::Command::new("mkfifo")
                .arg(f.source.join("pipe"))
                .status()
                .unwrap()
                .success()
        );
        let failure = copy(&f, "pipe").unwrap_err().into_failure();
        assert_eq!(failure.message, "source is not a regular file: pipe");
    }

    #[test]
    fn destination_symlink_cannot_redirect_a_write() {
        let f = fixture();
        fs::write(f.outside.join("target"), b"original").unwrap();
        symlink(f.outside.join("target"), f.destination.join(".env")).unwrap();
        fs::write(f.source.join(".env"), b"new").unwrap();
        assert!(copy(&f, ".env").is_err());
        assert_eq!(fs::read(f.outside.join("target")).unwrap(), b"original");
        assert_no_temporary(&f.destination);
    }

    #[test]
    fn destination_symlink_parent_cannot_redirect_a_write() {
        let f = fixture();
        symlink(&f.outside, f.destination.join("dir")).unwrap();
        fs::create_dir_all(f.source.join("dir")).unwrap();
        fs::write(f.source.join("dir/.env"), b"new").unwrap();
        assert!(copy(&f, "dir/.env").is_err());
        assert!(!f.outside.join(".env").exists());
    }

    #[test]
    fn a_directory_is_never_replaced_by_a_file() {
        let f = fixture();
        fs::create_dir_all(f.destination.join(".env/inner")).unwrap();
        fs::write(f.source.join(".env"), b"new").unwrap();
        assert!(copy(&f, ".env").is_err());
        assert!(f.destination.join(".env/inner").is_dir());
        assert_no_temporary(&f.destination);
    }

    #[test]
    fn a_file_in_a_directory_position_fails() {
        let f = fixture();
        fs::write(f.destination.join("dir"), b"file").unwrap();
        fs::create_dir_all(f.source.join("dir")).unwrap();
        fs::write(f.source.join("dir/.env"), b"new").unwrap();
        assert!(copy(&f, "dir/.env").is_err());
        assert_eq!(fs::read(f.destination.join("dir")).unwrap(), b"file");
    }

    #[test]
    fn replacing_a_hard_linked_destination_leaves_the_other_link_intact() {
        let f = fixture();
        fs::write(f.outside.join("peer"), b"peer-bytes").unwrap();
        fs::hard_link(f.outside.join("peer"), f.destination.join(".env")).unwrap();
        fs::write(f.source.join(".env"), b"new").unwrap();
        copy(&f, ".env").unwrap();
        assert_eq!(fs::read(f.destination.join(".env")).unwrap(), b"new");
        assert_eq!(fs::read(f.outside.join("peer")).unwrap(), b"peer-bytes");
    }

    #[test]
    fn an_expired_deadline_removes_the_temporary_file() {
        let f = fixture();
        fs::write(f.source.join(".env"), vec![b'x'; 200_000]).unwrap();
        let source = rustix::fs::open(&f.source, directory_flags(), Mode::empty()).unwrap();
        let destination = bind_root(&f.destination).unwrap().unwrap();
        let result = copy_file(&source, &destination, b".env", Instant::now());
        assert!(matches!(result, Err(SeedError::TimedOut)));
        assert!(!f.destination.join(".env").exists());
        assert_no_temporary(&f.destination);
    }

    #[test]
    fn destination_root_is_bound_by_real_path() {
        let f = fixture();
        assert!(bind_root(&f.destination).unwrap().is_some());
        let alias = f.outside.join("alias");
        symlink(&f.destination, &alias).unwrap();
        assert!(
            bind_root(&alias).unwrap().is_none(),
            "a final link is not followed"
        );
        let parent_link = f.outside.join("parent");
        symlink(f.destination.parent().unwrap(), &parent_link).unwrap();
        assert!(
            bind_root(&parent_link.join("destination"))
                .unwrap()
                .is_none(),
            "a link in the path makes the real path differ"
        );
    }

    #[tokio::test]
    async fn a_moved_root_fails_and_receives_nothing() {
        let _path_lock = crate::tests::PATH_LOCK.lock().await;
        let f = fixture();
        init_repository(&f.source);
        fs::write(f.source.join(".gitignore"), ".env\n").unwrap();
        fs::write(f.source.join(".worktreeinclude"), ".env\n").unwrap();
        fs::write(f.source.join(".env"), "SECRET=1\n").unwrap();
        let alias = f.outside.join("alias");
        symlink(&f.destination, &alias).unwrap();
        let deadline = Instant::now() + std::time::Duration::from_secs(30);
        let result = seed(&f.source, &alias, deadline).await;
        assert!(matches!(
            result,
            Err(SeedError::Failed("worktree root moved", None))
        ));
        assert!(!f.destination.join(".env").exists());
    }

    #[tokio::test]
    async fn nothing_selected_never_binds_the_destination() {
        let _path_lock = crate::tests::PATH_LOCK.lock().await;
        let f = fixture();
        let missing = f.outside.join("missing");
        let deadline = Instant::now() + Duration::from_secs(30);
        seed(&f.source, &missing, deadline).await.unwrap();
        fs::write(f.source.join(".worktreeinclude"), "# nothing\n").unwrap();
        seed(&f.source, &missing, deadline).await.unwrap();
        init_repository(&f.source);
        fs::write(f.source.join(".worktreeinclude"), ".env\n").unwrap();
        seed(&f.source, &missing, deadline).await.unwrap();
        assert!(!missing.exists());
    }

    #[tokio::test]
    async fn enumeration_stops_at_the_deadline() {
        let _path_lock = crate::tests::PATH_LOCK.lock().await;
        let f = fixture();
        let git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|directory| directory.join("git"))
            .find(|path| path.is_file())
            .unwrap();
        let sleep = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|directory| directory.join("sleep"))
            .find(|path| path.is_file())
            .unwrap();
        init_repository(&f.source);
        let bin = f.outside.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let shim = bin.join("git");
        fs::write(
            &shim,
            format!(
                "#!/bin/sh\ncase \" $* \" in *' ls-files '*) exec '{}' 30;; esac\nexec '{}' \"$@\"\n",
                sleep.display(),
                git.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&shim, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(f.source.join(".worktreeinclude"), ".env\n").unwrap();
        *crate::GIT_PATH_OVERRIDE.lock().unwrap() = Some(bin);
        let started = Instant::now();
        let result = seed(
            &f.source,
            &f.destination,
            Instant::now() + Duration::from_millis(300),
        )
        .await;
        *crate::GIT_PATH_OVERRIDE.lock().unwrap() = None;
        assert!(matches!(result, Err(SeedError::TimedOut)), "{result:?}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn a_source_reached_through_a_link_fails_and_reads_nothing() {
        let f = fixture();
        fs::write(f.source.join(".worktreeinclude"), ".env\n").unwrap();
        fs::write(f.source.join(".env"), "SECRET=1\n").unwrap();
        let parent_link = f.outside.join("source-parent");
        symlink(f.source.parent().unwrap(), &parent_link).unwrap();
        let redirected = parent_link.join(f.source.file_name().unwrap());
        let deadline = Instant::now() + std::time::Duration::from_secs(30);
        let result = seed(&redirected, &f.destination, deadline).await;
        assert!(matches!(
            result,
            Err(SeedError::Failed("copy source moved", None))
        ));
        assert!(!f.destination.join(".env").exists());
    }
}
