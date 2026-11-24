//! `FilesService`: stat, list, read, edit, write, bytes, and grep.

mod mutate;

use machine_core::{Context, IdempotencyCache};
use machine_protocol::v1::{
    EditRequest, EditResponse, GrepRequest, GrepResponse, FilesServiceListRequest, FilesServiceListResponse, ReadBytesRequest,
    ReadBytesResponse, ReadRequest, ReadResponse, StatRequest, StatResponse, WriteRequest, WriteResponse,
    files_service_server::{FilesService, FilesServiceServer},
};
use tonic::{Request, Response, Status};

pub fn service(context: Context) -> FilesServiceServer<Files> {
    FilesServiceServer::new(Files { context, edits: IdempotencyCache::default(), writes: IdempotencyCache::default() })
}

pub struct Files {
    context: Context,
    edits: IdempotencyCache<Result<EditResponse, Status>>,
    writes: IdempotencyCache<Result<WriteResponse, Status>>,
}

type Bytes = tokio_stream::wrappers::ReceiverStream<Result<ReadBytesResponse, Status>>;

#[tonic::async_trait]
impl FilesService for Files {
    async fn stat(&self, _: Request<StatRequest>) -> Result<Response<StatResponse>, Status> {
        Err(Status::unimplemented("Files.Stat"))
    }
    async fn list(&self, _: Request<FilesServiceListRequest>) -> Result<Response<FilesServiceListResponse>, Status> {
        Err(Status::unimplemented("Files.List"))
    }
    async fn read(&self, _: Request<ReadRequest>) -> Result<Response<ReadResponse>, Status> {
        Err(Status::unimplemented("Files.Read"))
    }
    async fn edit(&self, request: Request<EditRequest>) -> Result<Response<EditResponse>, Status> {
        let request = request.into_inner();
        let key = request.idempotency_key.clone();
        self.edits.run(&key, || mutate::edit(&self.context, request)).await.map(Response::new)
    }
    async fn write(&self, request: Request<WriteRequest>) -> Result<Response<WriteResponse>, Status> {
        let request = request.into_inner();
        let key = request.idempotency_key.clone();
        self.writes.run(&key, || mutate::write(&self.context, request)).await.map(Response::new)
    }
    type ReadBytesStream = Bytes;
    async fn read_bytes(&self, _: Request<ReadBytesRequest>) -> Result<Response<Self::ReadBytesStream>, Status> {
        Err(Status::unimplemented("Files.ReadBytes"))
    }
    async fn grep(&self, request: Request<GrepRequest>) -> Result<Response<GrepResponse>, Status> {
        machine_grep::grep(&self.context, request.into_inner()).await.map(Response::new)
    }
}
