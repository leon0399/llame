//! Content search for `FileService.SearchFiles`.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use machine_core::{Context, PathKind, refusal};
use machine_protocol::v1::{
    FileFailure, FileFailureReason, Line, Match, SearchEnd, SearchFilesRequest,
    SearchFilesResponse, SearchPosition, SearchStop, SkipReason, Skipped,
    search_files_response::Event,
};
use regex::{Regex, RegexBuilder};
use tonic::{Request, Status};

pub type SearchStream = tokio_stream::wrappers::ReceiverStream<Result<SearchFilesResponse, Status>>;

const MAX_PATTERNS: usize = 8;
const MAX_PATTERN_BYTES: usize = 512;
const CHANNEL_CAPACITY: usize = 16;

#[derive(Clone)]
struct Entry {
    rel: String,
    path: PathBuf,
    is_dir: bool,
    is_link: bool,
}

#[allow(clippy::too_many_lines, clippy::unused_async)]
pub async fn search(
    context: &Context,
    request: Request<SearchFilesRequest>,
) -> Result<SearchStream, Status> {
    let timeout = request
        .metadata()
        .get("grpc-timeout")
        .map(|value| {
            value
                .to_str()
                .map_err(|_| refusal::invalid_argument("invalid grpc-timeout"))
        })
        .transpose()?;
    let deadline = parse_deadline(timeout)?;
    let request = request.into_inner();
    let guard = context.guard();
    let guarded = guard.resolve(&request.path)?;
    if guarded.kind == PathKind::Missing || guarded.kind == PathKind::Other {
        let reason = if guarded.kind == PathKind::Missing {
            FileFailureReason::NotFound
        } else {
            FileFailureReason::WrongKind
        };
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        let _ = sender.try_send(Ok(SearchFilesResponse {
            event: Some(Event::Failure(FileFailure {
                reason: reason as i32,
                message: "The search path is missing or has the wrong kind.".to_owned(),
                details: None,
            })),
        }));
        return Ok(tokio_stream::wrappers::ReceiverStream::new(receiver));
    }
    if request.patterns.is_empty() || request.patterns.len() > MAX_PATTERNS {
        return Err(refusal::invalid_argument(
            "patterns must contain 1 to 8 entries",
        ));
    }
    if request
        .patterns
        .iter()
        .any(|pattern| pattern.len() > MAX_PATTERN_BYTES)
    {
        return Err(refusal::invalid_argument(
            "patterns must not exceed 512 bytes",
        ));
    }
    if request.glob.contains(['{', '}', '[', ']']) {
        return Err(refusal::invalid_argument(
            "glob braces and character classes are unsupported",
        ));
    }
    let glob = compile_glob(&request.glob)?;
    let mut patterns = Vec::with_capacity(request.patterns.len());
    for pattern in &request.patterns {
        let source = if request.literal {
            regex::escape(pattern)
        } else {
            pattern.clone()
        };
        patterns.push(
            RegexBuilder::new(&source)
                .case_insensitive(request.ignore_case)
                .build()
                .map_err(|error| refusal::invalid_argument(format!("invalid pattern: {error}")))?,
        );
    }
    let after = request.after.clone();
    let path = guarded.path.clone();
    let guarded_before = guarded.clone();
    let bounds = request.bounds;
    let respect_ignore_files = request.respect_ignore_files;
    let context_lines = request.context_lines as usize;
    let (sender, receiver) = tokio::sync::mpsc::channel(CHANNEL_CAPACITY);
    tokio::task::spawn_blocking(move || {
        run_search(
            &guard,
            &guarded_before,
            &path,
            guarded.kind,
            &patterns,
            glob.as_ref(),
            context_lines,
            respect_ignore_files,
            after.as_ref(),
            bounds,
            deadline,
            &sender,
        );
    });
    Ok(tokio_stream::wrappers::ReceiverStream::new(receiver))
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn run_search(
    guard: &machine_core::RootGuard,
    guarded_before: &machine_core::GuardedPath,
    root: &Path,
    kind: PathKind,
    patterns: &[Regex],
    glob: Option<&Regex>,
    context_lines: usize,
    respect_ignore_files: bool,
    after: Option<&SearchPosition>,
    bounds: Option<machine_protocol::v1::SearchBounds>,
    deadline: Option<Instant>,
    sender: &tokio::sync::mpsc::Sender<Result<SearchFilesResponse, Status>>,
) {
    let mut ignore_rules = Vec::new();
    if respect_ignore_files && kind == PathKind::Directory {
        let registered_root = guard
            .roots()
            .iter()
            .filter(|registered| root.starts_with(registered))
            .max_by_key(|registered| registered.components().count())
            .map_or(root, PathBuf::as_path);
        collect_ignores(root, registered_root, &mut ignore_rules);
    }
    let mut walker = if kind == PathKind::File {
        Walker::file(root.to_path_buf())
    } else {
        match Walker::directory(root, root) {
            Ok(walker) => walker,
            Err(status) => {
                let _ = sender.blocking_send(Err(status));
                return;
            }
        }
    };
    let bounds = bounds.unwrap_or_default();
    let file_limit = u64::from(bounds.files.unwrap_or(u32::MAX));
    let byte_limit = bounds.bytes.unwrap_or(u64::MAX);
    let file_bytes_limit = bounds.file_bytes.unwrap_or(u64::MAX);
    let match_limit = u64::from(bounds.matches.unwrap_or(u32::MAX));
    let (mut files, mut bytes, mut matches) = (0u64, 0u64, 0u64);
    let mut stop = SearchStop::Complete;
    let mut position = None;
    let mut last_match_position = None;
    'walk: while let Some(entry) = walker.next() {
        if sender.is_closed() {
            return;
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            stop = SearchStop::Deadline;
            position = Some(last_match_position.take().unwrap_or(SearchPosition {
                path: entry.rel,
                line: 0,
            }));
            break;
        }
        if entry.is_dir {
            if respect_ignore_files && ignored(&entry.path, true, &ignore_rules) {
                if !skip(sender, &entry.rel, SkipReason::Ignored) {
                    return;
                }
                continue;
            }
            if respect_ignore_files {
                add_ignore_files(&entry.path, &mut ignore_rules);
            }
            walker.descend(&entry);
            continue;
        }
        if let Some(after) = &after
            && compare_rel(&entry.rel, &after.path).is_lt()
        {
            continue;
        }
        if entry.is_link {
            if !skip(sender, &entry.rel, SkipReason::Symlink) {
                return;
            }
            continue;
        }
        if respect_ignore_files
            && (is_ignore_file(&entry.rel) || ignored(&entry.path, false, &ignore_rules))
        {
            if !skip(sender, &entry.rel, SkipReason::Ignored) {
                return;
            }
            continue;
        }
        if glob.is_some_and(|glob| !glob.is_match(&entry.rel)) {
            continue;
        }
        if files >= file_limit {
            stop = SearchStop::Files;
            position = Some(SearchPosition {
                path: entry.rel,
                line: 0,
            });
            break;
        }
        let Ok(metadata) = fs::metadata(&entry.path) else {
            if !skip(sender, &entry.rel, SkipReason::Unreadable) {
                return;
            }
            continue;
        };
        if !metadata.is_file() {
            if !skip(sender, &entry.rel, SkipReason::Unreadable) {
                return;
            }
            continue;
        }
        if metadata.len() > file_bytes_limit {
            if !skip(sender, &entry.rel, SkipReason::TooLarge) {
                return;
            }
            continue;
        }
        if files > 0 && bytes.saturating_add(metadata.len()) > byte_limit {
            stop = SearchStop::Bytes;
            let line = after
                .as_ref()
                .filter(|a| a.path == entry.rel)
                .map_or(0, |a| a.line);
            position = Some(SearchPosition {
                path: entry.rel,
                line,
            });
            break;
        }
        let Ok(content) = fs::read(&entry.path) else {
            if !skip(sender, &entry.rel, SkipReason::Unreadable) {
                return;
            }
            continue;
        };
        files += 1;
        bytes = bytes.saturating_add(content.len() as u64);
        if content.contains(&0) {
            if !skip(sender, &entry.rel, SkipReason::Binary) {
                return;
            }
            continue;
        }
        let Ok(text) = std::str::from_utf8(&content) else {
            if !skip(sender, &entry.rel, SkipReason::NotUtf8) {
                return;
            }
            continue;
        };
        let lines: Vec<&str> = text.lines().collect();
        let start = after
            .as_ref()
            .filter(|a| a.path == entry.rel)
            .map_or(0, |a| a.line as usize);
        for (index, line) in lines.iter().enumerate().skip(start) {
            if sender.is_closed() {
                return;
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                stop = SearchStop::Deadline;
                position = Some(
                    last_match_position
                        .take()
                        .unwrap_or_else(|| SearchPosition {
                            path: entry.rel.clone(),
                            line: 0,
                        }),
                );
                break 'walk;
            }
            let ranges = matching_spans(line, patterns);
            if ranges.is_empty() {
                continue;
            }
            if matches >= match_limit {
                stop = SearchStop::Matches;
                position = Some(
                    last_match_position
                        .take()
                        .unwrap_or_else(|| SearchPosition {
                            path: entry.rel.clone(),
                            line: 0,
                        }),
                );
                break 'walk;
            }
            let first = index.saturating_sub(context_lines);
            let last = (index + context_lines).min(lines.len().saturating_sub(1));
            let match_lines = (first..=last)
                .map(|line_index| Line {
                    number: (line_index + 1) as u32,
                    text: lines[line_index].to_owned(),
                    spans: if line_index == index {
                        ranges
                            .iter()
                            .map(|(start, end)| machine_protocol::v1::Span {
                                start: *start as u32,
                                end: *end as u32,
                            })
                            .collect()
                    } else {
                        Vec::new()
                    },
                })
                .collect();
            let event = SearchFilesResponse {
                event: Some(Event::Match(Match {
                    path: entry.rel.clone(),
                    line: (index + 1) as u32,
                    lines: match_lines,
                })),
            };
            if !emit(sender, event) {
                return;
            }
            last_match_position = Some(SearchPosition {
                path: entry.rel.clone(),
                line: (index + 1) as u32,
            });
            matches += 1;
        }
    }
    if let Err(status) = guard.verify_unchanged(guarded_before) {
        let _ = sender.blocking_send(Err(status));
        return;
    }
    let _ = emit(
        sender,
        SearchFilesResponse {
            event: Some(Event::End(SearchEnd {
                stop: stop as i32,
                position,
                files: files as u32,
                bytes,
                matches: matches as u32,
            })),
        },
    );
}

fn parse_deadline(timeout: Option<&str>) -> Result<Option<Instant>, Status> {
    let Some(timeout) = timeout else {
        return Ok(None);
    };
    if timeout.len() < 2 || timeout.len() > 9 {
        return Err(refusal::invalid_argument("invalid grpc-timeout"));
    }
    let (digits, unit) = timeout.split_at(timeout.len() - 1);
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(refusal::invalid_argument("invalid grpc-timeout"));
    }
    let value = digits
        .parse::<u64>()
        .map_err(|_| refusal::invalid_argument("invalid grpc-timeout"))?;
    let nanos_per_unit = match unit {
        "H" => 3_600_000_000_000_u64,
        "M" => 60_000_000_000,
        "S" => 1_000_000_000,
        "m" => 1_000_000,
        "u" => 1_000,
        "n" => 1,
        _ => return Err(refusal::invalid_argument("invalid grpc-timeout")),
    };
    let nanos = value
        .checked_mul(nanos_per_unit)
        .ok_or_else(|| refusal::invalid_argument("invalid grpc-timeout"))?;
    Ok(Instant::now().checked_add(Duration::from_nanos(nanos)))
}
fn emit(
    sender: &tokio::sync::mpsc::Sender<Result<SearchFilesResponse, Status>>,
    response: SearchFilesResponse,
) -> bool {
    sender.blocking_send(Ok(response)).is_ok()
}

fn skip(
    sender: &tokio::sync::mpsc::Sender<Result<SearchFilesResponse, Status>>,
    path: &str,
    reason: SkipReason,
) -> bool {
    emit(
        sender,
        SearchFilesResponse {
            event: Some(Event::Skipped(Skipped {
                path: path.to_owned(),
                reason: reason as i32,
            })),
        },
    )
}

struct Walker {
    root: PathBuf,
    pending: Vec<Entry>,
}

impl Walker {
    fn file(path: PathBuf) -> Self {
        Self {
            root: path.clone(),
            pending: vec![Entry {
                rel: String::new(),
                path,
                is_dir: false,
                is_link: false,
            }],
        }
    }

    fn directory(root: &Path, dir: &Path) -> Result<Self, Status> {
        let mut walker = Self {
            root: root.to_path_buf(),
            pending: Vec::new(),
        };
        walker.push_children(dir, true)?;
        Ok(walker)
    }

    fn next(&mut self) -> Option<Entry> {
        self.pending.pop()
    }

    fn descend(&mut self, entry: &Entry) {
        let _ = self.push_children(&entry.path, false);
    }

    fn push_children(&mut self, dir: &Path, required: bool) -> Result<(), Status> {
        let iter = match fs::read_dir(dir) {
            Ok(iter) => iter,
            Err(_) if !required => return Ok(()),
            Err(_) => return Err(Status::internal("directory could not be read")),
        };
        let mut entries = Vec::new();
        for item in iter.flatten() {
            let path = item.path();
            if path.file_name().is_some_and(|name| name == ".git") {
                continue;
            }
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            let is_link = metadata.file_type().is_symlink();
            let is_dir = metadata.is_dir() && !is_link;
            let rel = path
                .strip_prefix(&self.root)
                .map_err(|_| Status::internal("walk escaped search root"))?
                .to_string_lossy()
                .replace('\\', "/");
            entries.push(Entry {
                rel,
                path,
                is_dir,
                is_link,
            });
        }
        entries.sort_by(|left, right| left.rel.as_bytes().cmp(right.rel.as_bytes()));
        self.pending.extend(entries.into_iter().rev());
        Ok(())
    }
}

fn compare_rel(left: &str, right: &str) -> std::cmp::Ordering {
    left.split('/').cmp(right.split('/'))
}

fn compile_glob(pattern: &str) -> Result<Option<Regex>, Status> {
    if pattern.is_empty() {
        return Ok(None);
    }
    let mut source = String::from("^");
    let mut chars = pattern.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    chars.next();
                    source.push_str("(?:.*/)?");
                } else {
                    source.push_str(".*");
                }
            }
            '*' => source.push_str("[^/]*"),
            '?' => source.push_str("[^/]"),
            other => source.push_str(&regex::escape(&other.to_string())),
        }
    }
    source.push('$');
    Regex::new(&source)
        .map(Some)
        .map_err(|_| refusal::invalid_argument("invalid glob"))
}

fn matching_spans(line: &str, patterns: &[Regex]) -> Vec<(usize, usize)> {
    let mut spans: Vec<_> = patterns
        .iter()
        .flat_map(|pattern| pattern.find_iter(line).map(|m| (m.start(), m.end())))
        .collect();
    spans.sort_unstable();
    spans.dedup();
    spans
}

fn collect_ignores(
    root: &Path,
    registered_root: &Path,
    rules: &mut Vec<(PathBuf, ignore::gitignore::Gitignore)>,
) {
    let mut ancestors = Vec::new();
    let mut dir = root.to_path_buf();
    while dir.starts_with(registered_root) {
        ancestors.push(dir.clone());
        if dir == registered_root {
            break;
        }
        if !dir.pop() {
            break;
        }
    }
    let ordered = ancestors.into_iter().rev().collect::<Vec<_>>();
    let repository = ordered
        .iter()
        .rposition(|dir| dir.join(".git").exists())
        .unwrap_or(0);
    for (index, dir) in ordered.iter().enumerate() {
        if index >= repository {
            add_ignore_file(dir, ".gitignore", rules);
        }
        add_ignore_file(dir, ".ignore", rules);
    }
}

fn add_ignore_files(dir: &Path, rules: &mut Vec<(PathBuf, ignore::gitignore::Gitignore)>) {
    add_ignore_file(dir, ".gitignore", rules);
    add_ignore_file(dir, ".ignore", rules);
}

fn add_ignore_file(
    dir: &Path,
    name: &str,
    rules: &mut Vec<(PathBuf, ignore::gitignore::Gitignore)>,
) {
    let file = dir.join(name);
    if !file.is_file() {
        return;
    }
    let mut builder = ignore::gitignore::GitignoreBuilder::new(dir);
    if builder.add(&file).is_none()
        && let Ok(matcher) = builder.build()
    {
        rules.push((dir.to_path_buf(), matcher));
    }
}

fn ignored(path: &Path, is_dir: bool, rules: &[(PathBuf, ignore::gitignore::Gitignore)]) -> bool {
    let mut ignored = false;
    for (_, matcher) in rules {
        let matched = matcher.matched(path, is_dir);
        if matched.is_ignore() {
            ignored = true;
        } else if matched.is_whitelist() {
            ignored = false;
        }
    }
    ignored
}

fn is_ignore_file(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|name| matches!(name, ".gitignore" | ".ignore"))
}
