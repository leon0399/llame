//! `JobService`: every command runs as a job with output files on disk.

use machine_core::Context;
use machine_protocol::v1::{
    CancelJobRequest, CancelJobResponse, CreateJobRequest, CreateJobResponse, DeleteJobRequest, DeleteJobResponse,
    GetJobRequest, GetJobResponse, ListJobsRequest, ListJobsResponse, ReadOutputRequest, ReadOutputResponse,
    WatchJobsRequest, WatchJobsResponse,
    job_service_server::{JobService, JobServiceServer},
};
use tonic::{Request, Response, Status};

/// Opens the job store under `<state_dir>/jobs`.
#[allow(clippy::unused_async)]
pub async fn service(context: Context) -> anyhow::Result<JobServiceServer<Jobs>> {
    Ok(JobServiceServer::new(Jobs { _context: context }))
}

pub struct Jobs {
    _context: Context,
}

type Stream<T> = tokio_stream::wrappers::ReceiverStream<Result<T, Status>>;

#[tonic::async_trait]
impl JobService for Jobs {
    async fn create_job(&self, _: Request<CreateJobRequest>) -> Result<Response<CreateJobResponse>, Status> {
        Err(Status::unimplemented("JobService.CreateJob"))
    }
    async fn get_job(&self, _: Request<GetJobRequest>) -> Result<Response<GetJobResponse>, Status> {
        Err(Status::unimplemented("JobService.GetJob"))
    }
    async fn list_jobs(&self, _: Request<ListJobsRequest>) -> Result<Response<ListJobsResponse>, Status> {
        Err(Status::unimplemented("JobService.ListJobs"))
    }
    type WatchJobsStream = Stream<WatchJobsResponse>;
    async fn watch_jobs(&self, _: Request<WatchJobsRequest>) -> Result<Response<Self::WatchJobsStream>, Status> {
        Err(Status::unimplemented("JobService.WatchJobs"))
    }
    type ReadOutputStream = Stream<ReadOutputResponse>;
    async fn read_output(&self, _: Request<ReadOutputRequest>) -> Result<Response<Self::ReadOutputStream>, Status> {
        Err(Status::unimplemented("JobService.ReadOutput"))
    }
    async fn cancel_job(&self, _: Request<CancelJobRequest>) -> Result<Response<CancelJobResponse>, Status> {
        Err(Status::unimplemented("JobService.CancelJob"))
    }
    async fn delete_job(&self, _: Request<DeleteJobRequest>) -> Result<Response<DeleteJobResponse>, Status> {
        Err(Status::unimplemented("JobService.DeleteJob"))
    }
}
