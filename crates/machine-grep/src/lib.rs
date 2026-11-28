//! Content search for `FileService.SearchFiles`.

use std::{
    fs,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
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
use walk_policy::{
    add_ignore_files, collect_ignores, ignored, is_fixed, is_ignore_file, registered_root,
};

pub mod walk_policy;

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
    let invalid_scope =
        guarded.is_link || (!request.glob.is_empty() && guarded.kind != PathKind::Directory);
    if guarded.kind == PathKind::Missing || guarded.kind == PathKind::Other || invalid_scope {
        let reason = if guarded.kind == PathKind::Missing || invalid_scope {
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

fn truncate_to_complete_lines(content: &mut Vec<u8>) {
    let complete_len = content
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |newline| newline + 1);
    content.truncate(complete_len);
}
fn seek_after_lines(file: &mut fs::File, lines: usize) -> std::io::Result<u64> {
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    for _ in 0..lines {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            break;
        }
    }
    reader.stream_position()
}

fn compare_positions(left: &SearchPosition, right: &SearchPosition) -> std::cmp::Ordering {
    compare_rel(&left.path, &right.path)
        .then_with(|| left.line.cmp(&right.line))
        .then_with(|| left.byte_offset.cmp(&right.byte_offset))
}

fn stopped_position(
    last_match: Option<SearchPosition>,
    after: Option<&SearchPosition>,
    fallback: SearchPosition,
) -> SearchPosition {
    if fallback.byte_offset.is_some() {
        return fallback;
    }
    if let Some(last_match) = last_match {
        return last_match;
    }
    if after.is_some_and(|after| compare_positions(after, &fallback).is_gt()) {
        after.cloned().unwrap_or(fallback)
    } else {
        fallback
    }
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
        collect_ignores(
            root,
            registered_root(guard.roots(), root),
            &mut ignore_rules,
        );
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
            position = Some(stopped_position(
                last_match_position.take(),
                after,
                SearchPosition {
                    path: entry.rel,
                    line: 0,
                    byte_offset: None,
                },
            ));
            break;
        }
        if entry.is_dir {
            if respect_ignore_files && ignored(&entry.path, true, &ignore_rules) {
                let before_cursor =
                    after.is_some_and(|position| compare_rel(&entry.rel, &position.path).is_lt());
                if !before_cursor && !skip(sender, &entry.rel, SkipReason::Ignored) {
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
            // Only a directory the walker refused to enter belongs in the
            // excluded-directory report. Ignored files remain silent.
            continue;
        }
        if glob.is_some_and(|glob| !glob.is_match(&entry.rel)) {
            continue;
        }
        let resume = after.filter(|position| position.path == entry.rel);
        let resumed_file =
            resume.is_some_and(|position| position.line > 0 || position.byte_offset.is_some());
        if files >= file_limit && !resumed_file {
            stop = SearchStop::Files;
            position = Some(stopped_position(
                last_match_position.take(),
                after,
                SearchPosition {
                    path: entry.rel,
                    line: 0,
                    byte_offset: None,
                },
            ));
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
        if bytes >= byte_limit {
            stop = SearchStop::Bytes;
            position = Some(SearchPosition {
                path: entry.rel.clone(),
                line: after
                    .as_ref()
                    .filter(|after| after.path == entry.rel)
                    .map_or(0, |after| after.line),
                byte_offset: None,
            });
            break;
        }
        let resume_line = resume.map_or(0, |position| position.line as usize);
        let mut resume_offset = resume.and_then(|position| position.byte_offset);
        let Ok(mut file) = fs::File::open(&entry.path) else {
            if !skip(sender, &entry.rel, SkipReason::Unreadable) {
                return;
            }
            continue;
        };
        if resume_offset.is_none() && resume_line > 0 {
            let Ok(offset) = seek_after_lines(&mut file, resume_line) else {
                if !skip(sender, &entry.rel, SkipReason::Unreadable) {
                    return;
                }
                continue;
            };
            resume_offset = Some(offset);
        }
        if let Some(offset) = resume_offset
            && file.seek(SeekFrom::Start(offset)).is_err()
        {
            if !skip(sender, &entry.rel, SkipReason::Unreadable) {
                return;
            }
            continue;
        }
        let mut content = Vec::new();
        let mut chunk = vec![0; 65_536];
        let mut byte_stopped = false;
        let mut deadline_stopped = false;
        let mut read_failed = false;
        loop {
            if sender.is_closed() {
                return;
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                deadline_stopped = true;
                break;
            }
            let remaining = byte_limit.saturating_sub(bytes.saturating_add(content.len() as u64));
            if remaining == 0 {
                if resume_offset
                    .unwrap_or(0)
                    .saturating_add(content.len() as u64)
                    < metadata.len()
                {
                    byte_stopped = true;
                }
                break;
            }
            let read_limit = if remaining < chunk.len() as u64 {
                remaining as usize
            } else {
                chunk.len()
            };
            let Ok(read) = file.read(&mut chunk[..read_limit]) else {
                read_failed = true;
                break;
            };
            if read == 0 {
                break;
            }
            content.extend_from_slice(&chunk[..read]);
        }
        let searched_offset = resume_offset
            .unwrap_or(0)
            .saturating_add(content.len() as u64);
        let binary = content.contains(&0);
        let invalid_utf8 = std::str::from_utf8(&content)
            .err()
            .is_some_and(|error| error.error_len().is_some());
        if byte_stopped || deadline_stopped {
            truncate_to_complete_lines(&mut content);
            stop = if deadline_stopped {
                SearchStop::Deadline
            } else {
                SearchStop::Bytes
            };
        }
        if read_failed {
            if !resumed_file {
                files += 1;
            }
            bytes = bytes.saturating_add(content.len() as u64);
            if !skip(sender, &entry.rel, SkipReason::Unreadable) {
                return;
            }
            continue;
        }
        if !resumed_file {
            files += 1;
        }
        bytes = bytes.saturating_add(searched_offset.saturating_sub(resume_offset.unwrap_or(0)));
        if binary {
            if !skip(sender, &entry.rel, SkipReason::Binary) {
                return;
            }
            if byte_stopped || deadline_stopped {
                position = Some(SearchPosition {
                    path: entry.rel,
                    line: resume_line as u32,
                    byte_offset: Some(metadata.len()),
                });
                break 'walk;
            }
            continue;
        }
        if invalid_utf8 {
            if !skip(sender, &entry.rel, SkipReason::NotUtf8) {
                return;
            }
            if byte_stopped || deadline_stopped {
                position = Some(SearchPosition {
                    path: entry.rel,
                    line: resume_line as u32,
                    byte_offset: Some(metadata.len()),
                });
                break 'walk;
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
        let start = if resume_offset.is_some() {
            0
        } else {
            resume_line
        };
        let line_base = if resume_offset.is_some() {
            resume_line
        } else {
            0
        };
        for (index, line) in lines.iter().enumerate().skip(start) {
            if sender.is_closed() {
                return;
            }
            if !deadline_stopped && deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                stop = SearchStop::Deadline;
                position = Some(stopped_position(
                    last_match_position.take(),
                    after,
                    SearchPosition {
                        path: entry.rel.clone(),
                        line: (line_base + index) as u32,
                        byte_offset: None,
                    },
                ));
                break 'walk;
            }
            let ranges = matching_spans(line, patterns);
            if ranges.is_empty() {
                continue;
            }
            if matches >= match_limit {
                let deferred_file = last_match_position
                    .as_ref()
                    .is_none_or(|position| position.path != entry.rel);
                if deferred_file {
                    if !resumed_file {
                        files = files.saturating_sub(1);
                    }
                    bytes = bytes
                        .saturating_sub(searched_offset.saturating_sub(resume_offset.unwrap_or(0)));
                }
                stop = SearchStop::Matches;
                position = Some(stopped_position(
                    last_match_position.take(),
                    after,
                    SearchPosition {
                        path: entry.rel.clone(),
                        line: (line_base + index) as u32,
                        byte_offset: None,
                    },
                ));
                break 'walk;
            }
            let first = index.saturating_sub(context_lines);
            let last = (index + context_lines).min(lines.len().saturating_sub(1));
            let match_lines = (first..=last)
                .map(|line_index| Line {
                    number: (line_base + line_index + 1) as u32,
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
                    line: (line_base + index + 1) as u32,
                    lines: match_lines,
                })),
            };
            if !emit(sender, event) {
                return;
            }
            last_match_position = Some(SearchPosition {
                path: entry.rel.clone(),
                line: (line_base + index + 1) as u32,
                byte_offset: None,
            });
            matches += 1;
        }
        if deadline_stopped {
            position = Some(stopped_position(
                last_match_position.take(),
                after,
                SearchPosition {
                    path: entry.rel.clone(),
                    line: (line_base + lines.len()) as u32,
                    byte_offset: Some(searched_offset),
                },
            ));
            break 'walk;
        }
        if byte_stopped {
            position = Some(stopped_position(
                last_match_position.take(),
                after,
                SearchPosition {
                    path: entry.rel,
                    line: (line_base + lines.len()) as u32,
                    byte_offset: Some(searched_offset),
                },
            ));
            break 'walk;
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
            if is_fixed(&path) {
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
                    source.push_str("(?s:(?:.*/))?");
                } else {
                    source.push_str("(?s:.*)");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadline_stop_keeps_the_later_reached_position() {
        let after = SearchPosition {
            path: "a.txt".into(),
            line: 1,
            byte_offset: None,
        };
        let stop = SearchPosition {
            path: "b.txt".into(),
            line: 0,
            byte_offset: None,
        };
        assert_eq!(stopped_position(None, Some(&after), stop.clone()), stop);
    }
    #[test]
    fn deadline_stops_discard_an_incomplete_line() {
        let mut content = b"complete\npartial".to_vec();
        truncate_to_complete_lines(&mut content);
        assert_eq!(content, b"complete\n");
    }
}
