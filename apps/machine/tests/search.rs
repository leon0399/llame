#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::wildcard_enum_match_arm,
    clippy::too_many_lines
)]

mod common;

use machine_protocol::v1::{
    SearchBounds, SearchFilesRequest, SearchPosition, SearchStop,
    file_service_client::FileServiceClient, search_files_response::Event,
};
use tonic::Code;

fn absolute(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

fn request(path: &std::path::Path, patterns: &[&str]) -> SearchFilesRequest {
    SearchFilesRequest {
        path: absolute(path),
        glob: String::new(),
        patterns: patterns
            .iter()
            .map(|pattern| (*pattern).to_owned())
            .collect(),
        literal: true,
        ignore_case: false,
        context_lines: 0,
        respect_ignore_files: false,
        after: None,
        bounds: None,
    }
}

#[tokio::test]
async fn search_streams_matches_skips_and_resumes_with_guards() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::create_dir_all(root.join("nested")).unwrap();
    std::fs::write(root.join("nested/a.txt"), "before\nNeedle\nafter\nneedle\n").unwrap();
    std::fs::write(root.join("nested/b.log"), "needle\n").unwrap();
    std::fs::write(root.join("nested/c.bin"), b"needle\0binary").unwrap();
    std::fs::write(root.join("nested/ignored.txt"), "needle\n").unwrap();
    std::fs::write(root.join("nested/.gitignore"), "ignored.txt\n").unwrap();
    let (mut child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);

    let mut req = request(root, &["needle"]);
    req.ignore_case = true;
    req.glob = "**/*".to_owned();
    req.context_lines = 1;
    req.respect_ignore_files = true;
    let mut stream = client.search_files(req).await.unwrap().into_inner();
    let mut found = Vec::new();
    let mut ignored_file_reported = false;
    let mut binary = false;
    let mut end = None;
    while let Some(item) = stream.message().await.unwrap() {
        match item.event.unwrap() {
            Event::Match(found_match) => found.push(found_match),
            Event::Skipped(skip) if skip.path.ends_with("ignored.txt") => {
                ignored_file_reported = true;
            }
            Event::Skipped(skip) if skip.path.ends_with("c.bin") => binary = true,
            Event::Skipped(_) => {}
            Event::End(search_end) => end = Some(search_end),
            Event::Failure(failure) => panic!("search failure: {failure:?}"),
        }
    }
    assert_eq!(found.len(), 3);
    assert_eq!(found[0].line, 2);
    assert_eq!(found[0].lines.len(), 3);
    assert_eq!(found[0].lines[1].spans.len(), 1);
    assert!(!ignored_file_reported);
    assert!(binary);
    assert_eq!(end.unwrap().stop, SearchStop::Complete as i32);

    let mut regex_request = request(&root.join("nested/a.txt"), &[r"Need.*"]);
    regex_request.literal = false;
    let mut regex_stream = client
        .search_files(regex_request)
        .await
        .unwrap()
        .into_inner();
    let mut regex_matches = 0;
    while let Some(item) = regex_stream.message().await.unwrap() {
        if let Some(Event::Match(_)) = item.event {
            regex_matches += 1;
        }
    }
    assert_eq!(regex_matches, 1);

    let mut limited = request(root, &["needle"]);
    limited.respect_ignore_files = true;
    limited.bounds = Some(SearchBounds {
        files: None,
        bytes: None,
        file_bytes: None,
        matches: Some(1),
    });
    let mut stream = client
        .search_files(limited.clone())
        .await
        .unwrap()
        .into_inner();
    let mut first_count = 0;
    let mut resume = None;
    while let Some(item) = stream.message().await.unwrap() {
        match item.event.unwrap() {
            Event::Match(_) => first_count += 1,
            Event::End(search_end) => resume = search_end.position,
            Event::Skipped(_) => {}
            Event::Failure(failure) => panic!("search failure: {failure:?}"),
        }
    }
    assert_eq!(first_count, 1);
    let after = resume.expect("match bound should expose a resume position");
    assert_eq!(after.path, "nested/a.txt");
    assert_eq!(after.line, 4);
    limited.after = Some(after);
    limited.bounds = None;
    let mut stream = client.search_files(limited).await.unwrap().into_inner();
    let mut resumed = Vec::new();
    while let Some(item) = stream.message().await.unwrap() {
        if let Some(Event::Match(found_match)) = item.event {
            resumed.push((found_match.path, found_match.line));
        }
    }
    assert_eq!(resumed, vec![("nested/b.log".to_owned(), 1)]);

    let mut byte_limited = request(root, &["needle"]);
    byte_limited.respect_ignore_files = true;
    byte_limited.bounds = Some(SearchBounds {
        files: None,
        bytes: Some(27),
        file_bytes: None,
        matches: None,
    });
    let mut stream = client
        .search_files(byte_limited.clone())
        .await
        .unwrap()
        .into_inner();
    let mut byte_end = None;
    let mut byte_matches = Vec::new();
    while let Some(item) = stream.message().await.unwrap() {
        match item.event {
            Some(Event::Match(found_match)) => {
                byte_matches.push((found_match.path, found_match.line));
            }
            Some(Event::End(search_end)) => byte_end = Some(search_end),
            _ => {}
        }
    }
    assert_eq!(byte_matches, vec![("nested/a.txt".to_owned(), 4)]);
    let byte_end = byte_end.unwrap();
    assert_eq!(byte_end.stop, SearchStop::Bytes as i32);
    let byte_resume = byte_end.position.unwrap();
    assert_eq!(byte_resume.path, "nested/b.log");
    byte_limited.after = Some(byte_resume);
    byte_limited.bounds = None;
    let mut stream = client
        .search_files(byte_limited)
        .await
        .unwrap()
        .into_inner();
    let mut resumed_after_bytes = Vec::new();
    while let Some(item) = stream.message().await.unwrap() {
        if let Some(Event::Match(found_match)) = item.event {
            resumed_after_bytes.push((found_match.path, found_match.line));
        }
    }
    assert_eq!(resumed_after_bytes, vec![("nested/b.log".to_owned(), 1)]);

    let mut invalid_glob = request(root, &["needle"]);
    invalid_glob.glob = "[a-z]".to_owned();
    assert_eq!(
        client.search_files(invalid_glob).await.unwrap_err().code(),
        Code::InvalidArgument
    );
    let outside = machine.home.path().join("outside.txt");
    std::fs::write(&outside, "needle\n").unwrap();
    assert_eq!(
        client
            .search_files(request(&outside, &["needle"]))
            .await
            .unwrap_err()
            .code(),
        Code::PermissionDenied
    );
    child.kill().await.unwrap();
}

#[tokio::test]
async fn missing_and_wrong_kind_search_paths_are_stream_failures() {
    let machine = common::Machine::new();
    let root = machine.root();
    let wrong_kind = root.join("socket");
    let _listener = std::os::unix::net::UnixListener::bind(&wrong_kind).unwrap();
    let (mut child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);

    for (path, expected) in [
        (
            root.join("missing"),
            machine_protocol::v1::FileFailureReason::NotFound,
        ),
        (
            wrong_kind,
            machine_protocol::v1::FileFailureReason::WrongKind,
        ),
    ] {
        let mut stream = client
            .search_files(request(&path, &["needle"]))
            .await
            .unwrap()
            .into_inner();
        let response = stream.message().await.unwrap().unwrap();
        assert!(matches!(
            response.event,
            Some(Event::Failure(failure)) if failure.reason == expected as i32
        ));
        assert!(stream.message().await.unwrap().is_none());
    }
    child.kill().await.unwrap();
}
#[tokio::test]
async fn search_scope_roots_that_cannot_be_walked_are_not_found() {
    let machine = common::Machine::new();
    let root = machine.root();
    let target = root.join("target");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("a.txt"), "needle\n").unwrap();
    let file = root.join("file.txt");
    std::fs::write(&file, "needle\n").unwrap();
    let link = root.join("linked");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);

    let mut linked_directory = request(&link, &["needle"]);
    linked_directory.glob = "**".into();
    let mut file_glob = request(&file, &["needle"]);
    file_glob.glob = "**".into();
    let linked_file = root.join("linked-file.txt");
    std::os::unix::fs::symlink(&file, &linked_file).unwrap();

    for req in [
        linked_directory,
        file_glob,
        request(&linked_file, &["needle"]),
    ] {
        let mut stream = client.search_files(req).await.unwrap().into_inner();
        let response = stream.message().await.unwrap().unwrap();
        assert!(matches!(
            response.event,
            Some(Event::Failure(failure))
                if failure.reason == machine_protocol::v1::FileFailureReason::NotFound as i32
        ));
        assert!(stream.message().await.unwrap().is_none());
    }
}

#[tokio::test]
async fn resumed_line_cursor_spends_only_remaining_file_and_byte_bounds() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::write(root.join("a.txt"), "needle\nneedle\n").unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);

    let mut req = request(root, &["needle"]);
    req.after = Some(SearchPosition {
        path: "a.txt".into(),
        line: 1,
        byte_offset: None,
    });
    req.bounds = Some(SearchBounds {
        files: Some(0),
        bytes: Some(7),
        file_bytes: None,
        matches: None,
    });

    let mut stream = client.search_files(req).await.unwrap().into_inner();
    let mut found = Vec::new();
    let mut end = None;
    while let Some(response) = stream.message().await.unwrap() {
        match response.event.unwrap() {
            Event::Match(found_match) => found.push(found_match),
            Event::End(search_end) => end = Some(search_end),
            Event::Failure(failure) => panic!("search failure: {failure:?}"),
            Event::Skipped(_) => {}
        }
    }

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].line, 2);
    let end = end.unwrap();
    assert_eq!(end.stop, SearchStop::Complete as i32);
    assert_eq!(end.files, 0);
    assert_eq!(end.bytes, 7);
}

#[tokio::test]
async fn stopped_search_positions_advance_past_the_incoming_cursor() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::write(root.join("a.txt"), "needle\n").unwrap();
    std::fs::write(root.join("b.txt"), "needle\n").unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);

    let mut bounded = request(root, &["needle"]);
    bounded.glob = "b.txt".into();
    bounded.after = Some(machine_protocol::v1::SearchPosition {
        path: "a.txt".into(),
        line: 1,
        byte_offset: None,
    });
    bounded.bounds = Some(SearchBounds {
        files: None,
        bytes: None,
        file_bytes: None,
        matches: Some(0),
    });
    let mut stream = client
        .search_files(bounded.clone())
        .await
        .unwrap()
        .into_inner();
    let mut position = None;
    while let Some(response) = stream.message().await.unwrap() {
        if let Some(Event::End(end)) = response.event {
            position = end.position;
        }
    }
    let position = position.unwrap();
    assert_eq!(position.path, "b.txt");
    bounded.after = Some(position);
    bounded.bounds = None;
    let mut stream = client.search_files(bounded).await.unwrap().into_inner();
    let mut resumed = Vec::new();
    while let Some(response) = stream.message().await.unwrap() {
        if let Some(Event::Match(found)) = response.event {
            resumed.push((found.path, found.line));
        }
    }
    assert_eq!(resumed, [("b.txt".into(), 1)]);
}

#[tokio::test]
async fn ignored_directory_is_not_walked() {
    let machine = common::Machine::new();
    let root = machine.root();
    let ignored = root.join("ignored");
    std::fs::create_dir_all(&ignored).unwrap();
    std::fs::write(root.join(".gitignore"), "ignored\n").unwrap();
    for index in 0..2000 {
        std::fs::write(ignored.join(format!("{index:04}.txt")), "needle").unwrap();
    }
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut req = request(root, &["needle"]);
    req.respect_ignore_files = true;
    let mut stream = client.search_files(req).await.unwrap().into_inner();
    let mut skipped = false;
    let mut matches = 0;
    let mut ended = false;
    while let Some(response) = stream.message().await.unwrap() {
        match response.event {
            Some(Event::Skipped(event)) if event.path == "ignored" => skipped = true,
            Some(Event::Match(_)) => matches += 1,
            Some(Event::End(end)) => {
                assert_eq!(end.files, 0);
                ended = true;
            }

            _ => {}
        }
    }
    assert!(skipped);
    assert_eq!(matches, 0);
    assert!(ended);
}
#[tokio::test]
async fn ignore_rules_do_not_apply_to_sibling_directories() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::create_dir_all(root.join("left")).unwrap();
    std::fs::create_dir_all(root.join("right")).unwrap();
    std::fs::write(root.join("left/.ignore"), "*.txt\n").unwrap();
    std::fs::write(root.join("left/hidden.txt"), "needle\n").unwrap();
    std::fs::write(root.join("right/shown.txt"), "needle\n").unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut req = request(root, &["needle"]);
    req.respect_ignore_files = true;
    let mut stream = client.search_files(req).await.unwrap().into_inner();
    let mut matched = Vec::new();
    while let Some(response) = stream.message().await.unwrap() {
        if let Some(Event::Match(found)) = response.event {
            matched.push(found.path);
        }
    }
    assert_eq!(matched, ["right/shown.txt"]);
}

#[tokio::test]
async fn resume_uses_depth_first_path_order_and_skips_fifos() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::create_dir_all(root.join("a")).unwrap();
    std::fs::write(root.join("a/z.txt"), "needle\n").unwrap();
    std::fs::write(root.join("a.txt"), "needle\n").unwrap();
    let fifo = root.join("fifo");
    assert!(
        std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut req = request(root, &["needle"]);
    req.bounds = Some(SearchBounds {
        files: None,
        bytes: None,
        file_bytes: None,
        matches: Some(1),
    });
    let mut stream = client.search_files(req.clone()).await.unwrap().into_inner();
    let mut first_path = None;
    let mut resume = None;
    while let Some(item) = tokio::time::timeout(std::time::Duration::from_secs(3), stream.message())
        .await
        .unwrap()
        .unwrap()
    {
        match item.event.unwrap() {
            Event::Match(found) => first_path = Some(found.path),
            Event::End(end) => resume = end.position,
            Event::Skipped(_) | Event::Failure(_) => {}
        }
    }
    assert_eq!(first_path.as_deref(), Some("a/z.txt"));
    req.after = resume;
    req.bounds = None;
    let mut stream = client.search_files(req).await.unwrap().into_inner();
    let mut paths = Vec::new();
    let mut fifo_skipped = false;
    while let Some(item) = tokio::time::timeout(std::time::Duration::from_secs(3), stream.message())
        .await
        .unwrap()
        .unwrap()
    {
        match item.event {
            Some(Event::Match(found)) => paths.push(found.path),
            Some(Event::Skipped(skipped)) if skipped.path == "fifo" => fifo_skipped = true,
            _ => {}
        }
    }
    assert_eq!(paths, ["a.txt"]);
    assert!(fifo_skipped);
}

#[tokio::test]
async fn ancestor_gitignore_does_not_cross_repository_boundary() {
    let machine = common::Machine::new();
    let root = machine.root();
    let scope = root.join("app/src");
    std::fs::create_dir_all(&scope).unwrap();
    std::fs::write(root.join(".gitignore"), "secret.txt\n").unwrap();
    std::fs::create_dir_all(root.join("app/.git")).unwrap();
    std::fs::write(scope.join("secret.txt"), "needle\n").unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut req = request(&scope, &["needle"]);
    req.respect_ignore_files = true;
    let mut stream = client.search_files(req).await.unwrap().into_inner();
    let mut found = Vec::new();
    while let Some(item) = stream.message().await.unwrap() {
        if let Some(Event::Match(found_match)) = item.event {
            found.push(found_match.path);
        }
    }
    assert_eq!(found, ["secret.txt"]);
}
#[tokio::test]
async fn same_byte_bound_resumes_through_a_large_file() {
    let machine = common::Machine::new();
    let root = machine.root();
    let mut large = String::from("needle\n");
    large.push_str(&"x\n".repeat(40_000));
    large.push_str("needle\n");
    std::fs::write(root.join("large.txt"), large).unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut req = request(root, &["needle"]);
    req.bounds = Some(SearchBounds {
        files: None,
        bytes: Some(65_536),
        file_bytes: None,
        matches: None,
    });

    let mut matches = Vec::new();
    let mut after: Option<SearchPosition> = None;
    let mut page_two_offset = None;
    for page in 0..3 {
        if page == 1 {
            page_two_offset = after.as_ref().and_then(|position| position.byte_offset);
        }
        req.after = after;
        let mut stream = client.search_files(req.clone()).await.unwrap().into_inner();
        let mut end = None;
        while let Some(response) = stream.message().await.unwrap() {
            match response.event {
                Some(Event::Match(found)) => matches.push(found.line),
                Some(Event::End(search_end)) => end = Some(search_end),
                _ => {}
            }
        }
        let end = end.unwrap();
        after = end.position;
        if end.stop == SearchStop::Complete as i32 {
            break;
        }
    }
    assert_eq!(matches, [1, 40_002]);
    assert!(page_two_offset.is_some_and(|offset| offset > 65_535));
    assert!(after.is_none());
}

#[tokio::test]
async fn byte_bound_makes_progress_through_a_line_larger_than_a_chunk() {
    let machine = common::Machine::new();
    let root = machine.root();
    let mut contents = "x".repeat(70_000);
    contents.push_str("\nneedle\n");
    std::fs::write(root.join("long-line.txt"), contents).unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut req = request(root, &["needle"]);
    req.bounds = Some(SearchBounds {
        files: None,
        bytes: Some(65_536),
        file_bytes: None,
        matches: None,
    });

    let mut after = None;
    let mut matches = Vec::new();
    let mut completed = false;
    for _ in 0..3 {
        req.after = after;
        let mut stream = client.search_files(req.clone()).await.unwrap().into_inner();
        let mut end = None;
        while let Some(response) = stream.message().await.unwrap() {
            match response.event {
                Some(Event::Match(found)) => matches.push(found.line),
                Some(Event::End(search_end)) => end = Some(search_end),
                _ => {}
            }
        }
        let end = end.unwrap();
        after = end.position;
        if end.stop == SearchStop::Complete as i32 {
            completed = true;
            break;
        }
    }
    assert_eq!(matches, [2]);
    assert!(completed);
}

#[tokio::test]
async fn byte_bound_skips_zero_budget_and_stops_between_chunks() {
    let machine = common::Machine::new();
    let root = machine.root();
    let zero_root = root.join("zero");
    let chunk_root = root.join("chunked");
    std::fs::create_dir_all(&zero_root).unwrap();
    std::fs::create_dir_all(&chunk_root).unwrap();
    std::fs::write(zero_root.join("only.txt"), "needle\n").unwrap();
    let mut large = String::from("needle\n");
    large.push_str(&"x\n".repeat(40_000));
    large.push_str("needle\n");
    std::fs::write(chunk_root.join("large.txt"), large).unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);

    let mut zero = request(&zero_root, &["needle"]);
    zero.bounds = Some(SearchBounds {
        files: None,
        bytes: Some(0),
        file_bytes: None,
        matches: None,
    });
    let mut stream = client.search_files(zero).await.unwrap().into_inner();
    let mut zero_end = None;
    while let Some(item) = stream.message().await.unwrap() {
        if let Some(Event::End(end)) = item.event {
            zero_end = Some(end);
        }
    }
    let zero_end = zero_end.unwrap();
    assert_eq!(zero_end.stop, SearchStop::Bytes as i32);
    assert_eq!(zero_end.files, 0);
    assert_eq!(zero_end.bytes, 0);
    assert_eq!(zero_end.position.unwrap().path, "only.txt");

    let mut bounded = request(&chunk_root, &["needle"]);
    bounded.bounds = Some(SearchBounds {
        files: None,
        bytes: Some(1),
        file_bytes: None,
        matches: None,
    });
    let mut stream = client.search_files(bounded).await.unwrap().into_inner();
    let mut matches = Vec::new();
    let mut end = None;
    while let Some(item) = stream.message().await.unwrap() {
        match item.event {
            Some(Event::Match(found)) => matches.push(found.path),
            Some(Event::End(search_end)) => end = Some(search_end),
            _ => {}
        }
    }
    assert!(matches.is_empty());
    let end = end.unwrap();
    assert_eq!(end.stop, SearchStop::Bytes as i32);
    assert_eq!(end.files, 1);
    assert_eq!(end.bytes, 1);
    assert_eq!(end.position.unwrap().byte_offset, Some(1));
}

#[tokio::test]
async fn unterminated_byte_bound_advances_without_overreading() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::write(root.join("unterminated.txt"), "x".repeat(200_000)).unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut req = request(root, &["x"]);
    req.bounds = Some(SearchBounds {
        files: None,
        bytes: Some(1),
        file_bytes: None,
        matches: None,
    });

    let mut offsets = Vec::new();
    let mut after = None;
    for _ in 0..2 {
        req.after = after;
        let mut stream = client.search_files(req.clone()).await.unwrap().into_inner();
        let mut end = None;
        while let Some(response) = stream.message().await.unwrap() {
            if let Some(Event::End(search_end)) = response.event {
                end = Some(search_end);
            }
        }
        let end = end.unwrap();
        assert_eq!(end.stop, SearchStop::Bytes as i32);
        assert_eq!(end.bytes, 1);
        after = end.position;
        offsets.push(after.as_ref().unwrap().byte_offset.unwrap());
    }
    assert_eq!(offsets, [1, 2]);
}

#[tokio::test]
async fn binary_file_stays_skipped_after_a_byte_bound_resume() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::write(root.join("binary.txt"), b"\0needle\n").unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut req = request(root, &["needle"]);
    req.bounds = Some(SearchBounds {
        files: None,
        bytes: Some(1),
        file_bytes: None,
        matches: None,
    });
    let mut stream = client.search_files(req.clone()).await.unwrap().into_inner();
    let mut first_end = None;
    let mut skipped = false;
    while let Some(response) = stream.message().await.unwrap() {
        match response.event {
            Some(Event::Skipped(skip)) => skipped |= skip.path == "binary.txt",
            Some(Event::End(end)) => first_end = Some(end),
            _ => {}
        }
    }
    let first_end = first_end.unwrap();
    assert!(skipped);
    assert_eq!(first_end.bytes, 1);
    req.after = first_end.position;
    let mut stream = client.search_files(req).await.unwrap().into_inner();
    let mut matches = Vec::new();
    while let Some(response) = stream.message().await.unwrap() {
        if let Some(Event::Match(found)) = response.event {
            matches.push(found.path);
        }
    }
    assert!(matches.is_empty());
}
