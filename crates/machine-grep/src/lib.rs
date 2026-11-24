//! Content search for `FileService.SearchFiles`.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use machine_core::{Context, PathKind, refusal};
use machine_protocol::v1::{
    Line, Match, SearchEnd, SearchFilesRequest, SearchFilesResponse, SearchPosition, SearchStop,
    SkipReason, Skipped, search_files_response::Event,
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

#[allow(clippy::too_many_lines)]
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
    if !matches!(guarded.kind, PathKind::File | PathKind::Directory) {
        return Err(refusal::invalid_argument(
            "search target must be a file or directory",
        ));
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
            guard,
            guarded_before,
            path,
            guarded.kind,
            patterns,
            glob,
            context_lines,
            respect_ignore_files,
            after,
            bounds,
            deadline,
            sender,
        );
    });
    Ok(tokio_stream::wrappers::ReceiverStream::new(receiver))
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn run_search(
    guard: machine_core::RootGuard,
    guarded_before: machine_core::GuardedPath,
    root: PathBuf,
    kind: PathKind,
    patterns: Vec<Regex>,
    glob: Option<Regex>,
    context_lines: usize,
    respect_ignore_files: bool,
    after: Option<SearchPosition>,
    bounds: Option<machine_protocol::v1::SearchBounds>,
    deadline: Option<Instant>,
    sender: tokio::sync::mpsc::Sender<Result<SearchFilesResponse, Status>>,
) {
    let mut entries = Vec::new();
    if kind == PathKind::File {
        entries.push(Entry {
            rel: String::new(),
            path: root.clone(),
            is_dir: false,
            is_link: false,
        });
    } else if let Err(status) = collect(&root, &root, &mut entries) {
        let _ = sender.blocking_send(Err(status));
        return;
    }
    entries.sort_by(|a, b| a.rel.as_bytes().cmp(b.rel.as_bytes()));
    let mut ignore_rules = Vec::new();
    if respect_ignore_files && kind == PathKind::Directory {
        collect_ignores(&root, &root, &mut ignore_rules);
    }
    let bounds = bounds.unwrap_or_default();
    let file_limit = bounds.files.unwrap_or(u32::MAX) as u64;
    let byte_limit = bounds.bytes.unwrap_or(u64::MAX);
    let file_bytes_limit = bounds.file_bytes.unwrap_or(u64::MAX);
    let match_limit = bounds.matches.unwrap_or(u32::MAX) as u64;
    let (mut files, mut bytes, mut matches) = (0u64, 0u64, 0u64);
    let mut stop = SearchStop::Complete;
    let mut position = None;
    let mut last_match_position = None;
    let mut ignored_dirs: Vec<String> = Vec::new();
    'walk: for entry in entries {
        if sender.is_closed() {
            return;
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            stop = SearchStop::Deadline;
            position = last_match_position.clone().or(Some(SearchPosition {
                path: entry.rel,
                line: 0,
            }));
            break;
        }
        if ignored_dirs
            .iter()
            .any(|directory| entry.rel.starts_with(&format!("{directory}/")))
        {
            continue;
        }
        if entry.is_dir {
            if entry.rel.is_empty() {
                continue;
            }
            if respect_ignore_files && ignored(&entry.rel, true, &ignore_rules) {
                ignored_dirs.push(entry.rel.clone());
                if !skip(&sender, &entry.rel, SkipReason::Ignored) {
                    return;
                }
            }
            continue;
        }
        if let Some(after) = &after
            && entry.rel.as_bytes() < after.path.as_bytes()
        {
            continue;
        }
        if entry.is_link {
            if !skip(&sender, &entry.rel, SkipReason::Symlink) {
                return;
            }
            continue;
        }
        if respect_ignore_files
            && (is_ignore_file(&entry.rel) || ignored(&entry.rel, false, &ignore_rules))
        {
            if !skip(&sender, &entry.rel, SkipReason::Ignored) {
                return;
            }
            continue;
        }
        if glob.as_ref().is_some_and(|glob| !glob.is_match(&entry.rel)) {
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
        let metadata = match fs::metadata(&entry.path) {
            Ok(metadata) => metadata,
            Err(_) => {
                if !skip(&sender, &entry.rel, SkipReason::Unreadable) {
                    return;
                }
                continue;
            }
        };
        if metadata.len() > file_bytes_limit {
            if !skip(&sender, &entry.rel, SkipReason::TooLarge) {
                return;
            }
            continue;
        }
        if bytes.saturating_add(metadata.len()) > byte_limit {
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
        let content = match fs::read(&entry.path) {
            Ok(content) => content,
            Err(_) => {
                if !skip(&sender, &entry.rel, SkipReason::Unreadable) {
                    return;
                }
                continue;
            }
        };
        files += 1;
        bytes = bytes.saturating_add(content.len() as u64);
        if content.contains(&0) {
            if !skip(&sender, &entry.rel, SkipReason::Binary) {
                return;
            }
            continue;
        }
        let text = match std::str::from_utf8(&content) {
            Ok(text) => text,
            Err(_) => {
                if !skip(&sender, &entry.rel, SkipReason::NotUtf8) {
                    return;
                }
                continue;
            }
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
                position = last_match_position.clone().or(Some(SearchPosition {
                    path: entry.rel.clone(),
                    line: 0,
                }));
                break 'walk;
            }
            let ranges = matching_spans(line, &patterns);
            if ranges.is_empty() {
                continue;
            }
            if matches >= match_limit {
                stop = SearchStop::Matches;
                position = last_match_position.clone().or(Some(SearchPosition {
                    path: entry.rel.clone(),
                    line: 0,
                }));
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
            if !emit(&sender, event) {
                return;
            }
            last_match_position = Some(SearchPosition {
                path: entry.rel.clone(),
                line: (index + 1) as u32,
            });
            matches += 1;
        }
    }
    if let Err(status) = guard.verify_unchanged(&guarded_before) {
        let _ = sender.blocking_send(Err(status));
        return;
    }
    let _ = emit(
        &sender,
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

fn collect(root: &Path, dir: &Path, entries: &mut Vec<Entry>) -> Result<(), Status> {
    let iter = fs::read_dir(dir).map_err(|_| Status::internal("directory could not be read"))?;
    for item in iter {
        let item = item.map_err(|_| Status::internal("directory could not be read"))?;
        let path = item.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| Status::internal("directory could not be read"))?;
        let is_link = metadata.file_type().is_symlink();
        let is_dir = metadata.is_dir() && !is_link;
        let rel = path
            .strip_prefix(root)
            .map_err(|_| Status::internal("walk escaped search root"))?
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(Entry {
            rel,
            path: path.clone(),
            is_dir,
            is_link,
        });
        if is_dir && item.file_name() != ".git" {
            collect(root, &path, entries)?;
        }
    }
    Ok(())
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

fn collect_ignores(root: &Path, dir: &Path, rules: &mut Vec<(String, bool, bool)>) {
    let base = dir
        .strip_prefix(root)
        .unwrap_or(Path::new(""))
        .to_string_lossy()
        .replace('\\', "/");
    for name in [".gitignore", ".ignore"] {
        if let Ok(content) = fs::read_to_string(dir.join(name)) {
            for line in content
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
            {
                let negated = line.starts_with('!');
                let rule = line
                    .trim_start_matches('!')
                    .trim_start_matches('/')
                    .trim_end_matches('/');
                rules.push((
                    if base.is_empty() {
                        rule.to_owned()
                    } else {
                        format!("{base}/{rule}")
                    },
                    negated,
                    line.ends_with('/'),
                ));
            }
        }
    }
    if let Ok(items) = fs::read_dir(dir) {
        for item in items.flatten() {
            let path = item.path();
            if fs::symlink_metadata(&path)
                .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
            {
                collect_ignores(root, &path, rules);
            }
        }
    }
}

fn ignored(path: &str, is_dir: bool, rules: &[(String, bool, bool)]) -> bool {
    let mut ignored = false;
    for (rule, negated, dir_only) in rules {
        let mut prefix = String::new();
        let mut inherited = false;
        let mut parts = path.split('/').peekable();
        while let Some(part) = parts.next() {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            if parts.peek().is_some() && glob_for_rule(rule, &prefix) {
                inherited = true;
            }
        }
        if inherited || (glob_for_rule(rule, path) && (!dir_only || is_dir)) {
            ignored = !negated;
        }
    }
    ignored
}

fn glob_for_rule(rule: &str, path: &str) -> bool {
    let pattern = rule.replace('.', "\\.");
    Regex::new(&format!("^{}$", pattern.replace('*', ".*"))).is_ok_and(|regex| regex.is_match(path))
}

fn is_ignore_file(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|name| matches!(name, ".gitignore" | ".ignore"))
}
