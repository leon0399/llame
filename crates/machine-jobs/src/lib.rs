//! `JobsService`: every command runs as a job with output files on disk.

use machine_core::Context;
use machine_protocol::v1::{
    JobsServiceListRequest, JobsServiceListResponse, ReadOutputRequest, ReadOutputResponse, ReleaseRequest,
    ReleaseResponse, StartRequest, StartResponse, StopRequest, StopResponse, WatchRequest, WatchResponse,
    jobs_service_server::{JobsService, JobsServiceServer},
};
use tonic::{Request, Response, Status};

/// Opens the job store under `<state_dir>/jobs`.
#[allow(clippy::unused_async)]
pub async fn service(context: Context) -> anyhow::Result<JobsServiceServer<Jobs>> {
    Ok(JobsServiceServer::new(Jobs { _context: context }))
}

pub struct Jobs {
    _context: Context,
}

type Stream<T> = tokio_stream::wrappers::ReceiverStream<Result<T, Status>>;

#[tonic::async_trait]
impl JobsService for Jobs {
    async fn start(&self, _: Request<StartRequest>) -> Result<Response<StartResponse>, Status> {
        Err(Status::unimplemented("Jobs.Start"))
    }
    type WatchStream = Stream<WatchResponse>;
    async fn watch(&self, _: Request<WatchRequest>) -> Result<Response<Self::WatchStream>, Status> {
        Err(Status::unimplemented("Jobs.Watch"))
    }
    async fn list(&self, _: Request<JobsServiceListRequest>) -> Result<Response<JobsServiceListResponse>, Status> {
        Err(Status::unimplemented("Jobs.List"))
    }
    type ReadOutputStream = Stream<ReadOutputResponse>;
    async fn read_output(&self, _: Request<ReadOutputRequest>) -> Result<Response<Self::ReadOutputStream>, Status> {
        Err(Status::unimplemented("Jobs.ReadOutput"))
    }
    async fn stop(&self, _: Request<StopRequest>) -> Result<Response<StopResponse>, Status> {
        Err(Status::unimplemented("Jobs.Stop"))
    }
    async fn release(&self, _: Request<ReleaseRequest>) -> Result<Response<ReleaseResponse>, Status> {
        Err(Status::unimplemented("Jobs.Release"))
    }
}
