#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::wildcard_enum_match_arm,
    clippy::too_many_lines
)]

mod common;

use machine_protocol::v1::{
    SearchBounds, SearchFilesRequest, SearchStop, file_service_client::FileServiceClient,
    search_files_response::Event,
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
    let mut ignored = false;
    let mut binary = false;
    let mut end = None;
    while let Some(item) = stream.message().await.unwrap() {
        match item.event.unwrap() {
            Event::Match(found_match) => found.push(found_match),
            Event::Skipped(skip) if skip.path.ends_with("ignored.txt") => ignored = true,
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
    assert!(ignored);
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
                byte_matches.push((found_match.path, found_match.line))
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
