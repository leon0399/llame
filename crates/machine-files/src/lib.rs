//! `FileService`: entries, bytes, lines, mutations, and search.
mod mutate;
mod read;

use machine_core::{Context, IdempotencyCache};
use machine_protocol::v1::{
    GetEntryRequest, GetEntryResponse, ListDirectoryRequest, ListDirectoryResponse,
    ReadBytesRequest, ReadBytesResponse, ReadLinesRequest, ReadLinesResponse, ReplaceTextRequest,
    ReplaceTextResponse, SearchFilesRequest, SearchFilesResponse, WriteFileRequest,
    WriteFileResponse,
    file_service_server::{FileService, FileServiceServer},
};
use tonic::{Request, Response, Status};

pub fn service(context: Context) -> FileServiceServer<Files> {
    FileServiceServer::new(Files {
        context,
        writes: IdempotencyCache::default(),
        replaces: IdempotencyCache::default(),
    })
}

pub struct Files {
    context: Context,
    writes: IdempotencyCache<Result<WriteFileResponse, Status>>,
    replaces: IdempotencyCache<Result<ReplaceTextResponse, Status>>,
}

type Stream<T> = tokio_stream::wrappers::ReceiverStream<Result<T, Status>>;

#[tonic::async_trait]
impl FileService for Files {
    async fn get_entry(
        &self,
        request: Request<GetEntryRequest>,
    ) -> Result<Response<GetEntryResponse>, Status> {
        Ok(Response::new(read::get_entry(
            &self.context,
            &request.into_inner().path,
        )?))
    }
    async fn list_directory(
        &self,
        request: Request<ListDirectoryRequest>,
    ) -> Result<Response<ListDirectoryResponse>, Status> {
        let request = request.into_inner();
        Ok(Response::new(read::list_directory(
            &self.context,
            &request.path,
            request.offset,
            request.limit,
        )?))
    }
    type ReadBytesStream = Stream<ReadBytesResponse>;
    async fn read_bytes(
        &self,
        request: Request<ReadBytesRequest>,
    ) -> Result<Response<Self::ReadBytesStream>, Status> {
        let request = request.into_inner();
        Ok(Response::new(
            read::read_bytes(&self.context, &request.path, request.offset, request.limit).await?,
        ))
    }
    async fn read_lines(
        &self,
        request: Request<ReadLinesRequest>,
    ) -> Result<Response<ReadLinesResponse>, Status> {
        let request = request.into_inner();
        let context = self.context.clone();
        let response = tokio::task::spawn_blocking(move || {
            read::read_lines(
                &context,
                &request.path,
                request.start_line,
                request.limit,
                request.max_bytes,
            )
        })
        .await
        .map_err(|_| Status::internal("line read task panicked"))??;
        Ok(Response::new(response))
    }
    async fn write_file(
        &self,
        request: Request<WriteFileRequest>,
    ) -> Result<Response<WriteFileResponse>, Status> {
        let request = request.into_inner();
        let key = request.request_id.clone();
        let context = self.context.clone();
        self.writes
            .run(&key, move || async move {
                mutate::write(&context, request).await
            })
            .await
            .map_err(|_| Status::internal("idempotent work panicked"))?
            .map(Response::new)
    }
    async fn replace_text(
        &self,
        request: Request<ReplaceTextRequest>,
    ) -> Result<Response<ReplaceTextResponse>, Status> {
        let request = request.into_inner();
        let key = request.request_id.clone();
        let context = self.context.clone();
        self.replaces
            .run(&key, move || async move {
                mutate::replace(&context, request).await
            })
            .await
            .map_err(|_| Status::internal("idempotent work panicked"))?
            .map(Response::new)
    }
    type SearchFilesStream = Stream<SearchFilesResponse>;
    async fn search_files(
        &self,
        request: Request<SearchFilesRequest>,
    ) -> Result<Response<Self::SearchFilesStream>, Status> {
        machine_grep::search(&self.context, request)
            .await
            .map(Response::new)
    }
}
