//! The gRPC services the daemon serves: the frozen bootstrap service and the
//! main `stead.machine.v1` services.

use machine_core::{Context, facts};
use machine_protocol::{
    bootstrap::v1::{
        GetInfoRequest, GetInfoResponse,
        bootstrap_service_server::{BootstrapService, BootstrapServiceServer},
    },
    v1::{
        RootsServiceListRequest, RootsServiceListResponse, RootDisk,
        roots_service_server::{RootsService, RootsServiceServer},
    },
};
use tonic::{Request, Response, Status, service::RoutesBuilder};

use crate::identity::Identity;

/// Every service, built once per daemon. A layer that adds a service family
/// registers it here.
pub async fn routes(context: &Context, identity: Identity) -> anyhow::Result<tonic::service::Routes> {
    let mut routes = RoutesBuilder::default();
    routes.add_service(BootstrapServiceServer::new(Bootstrap { identity }));
    routes.add_service(RootsServiceServer::new(Roots { context: context.clone() }));
    routes.add_service(machine_files::service(context.clone()));
    routes.add_service(machine_jobs::service(context.clone()).await?);
    routes.add_service(machine_git::service(context.clone()));
    routes.add_service(machine_mcp::service(context.clone()));
    Ok(routes.routes())
}

struct Bootstrap {
    identity: Identity,
}

#[tonic::async_trait]
impl BootstrapService for Bootstrap {
    async fn get_info(&self, _: Request<GetInfoRequest>) -> Result<Response<GetInfoResponse>, Status> {
        Ok(Response::new(GetInfoResponse {
            instance_id: self.identity.instance_id.clone(),
            release_version: self.identity.release_version.clone(),
            build_id: self.identity.build_id.clone(),
            protocol_version: self.identity.protocol_version,
            boot_id: facts::boot_id(),
            facts: Some(facts::facts()),
            capabilities: capabilities(),
        }))
    }
}

/// What the box can do. Today: `bash` and `git` when present on `PATH`.
fn capabilities() -> Vec<machine_protocol::bootstrap::v1::Capability> {
    ["bash", "git"]
        .into_iter()
        .filter(|tool| {
            std::env::var_os("PATH").is_some_and(|path| {
                std::env::split_paths(&path).any(|dir| dir.join(tool).is_file())
            })
        })
        .map(|tool| machine_protocol::bootstrap::v1::Capability { name: tool.to_owned(), version: String::new() })
        .collect()
}

struct Roots {
    context: Context,
}

#[tonic::async_trait]
impl RootsService for Roots {
    async fn list(&self, _: Request<RootsServiceListRequest>) -> Result<Response<RootsServiceListResponse>, Status> {
        let config = self.context.config.current();
        let disks = config
            .roots
            .iter()
            .map(|root| RootDisk { root: root.clone(), total_bytes: facts::disk_total_bytes(root) })
            .collect();
        Ok(Response::new(RootsServiceListResponse {
            roots: config.roots.clone(),
            disks,
            max_running_jobs: config.limits.max_running_jobs,
        }))
    }
}
