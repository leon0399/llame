//! The gRPC services the daemon serves: the frozen bootstrap service and the
//! main `stead.machine.v1` services.

use machine_core::{Context, facts};
use machine_protocol::{
    bootstrap::v1::{
        GetInfoRequest, GetInfoResponse,
        bootstrap_service_server::{BootstrapService, BootstrapServiceServer},
    },
    v1::{
        GetLimitsRequest, GetLimitsResponse, Limits, ListRootsRequest, ListRootsResponse, Root,
        machine_service_server::{MachineService, MachineServiceServer},
    },
};
use tonic::{Request, Response, Status, service::RoutesBuilder};

use crate::identity::Identity;

/// Every service, built once per daemon. A layer that adds a service family
/// registers it here.
pub async fn routes(
    context: &Context,
    identity: Identity,
) -> anyhow::Result<tonic::service::Routes> {
    let mut routes = RoutesBuilder::default();
    routes.add_service(BootstrapServiceServer::new(Bootstrap { identity }));
    routes.add_service(MachineServiceServer::new(Machine {
        context: context.clone(),
    }));
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
    async fn get_info(
        &self,
        request: Request<GetInfoRequest>,
    ) -> Result<Response<GetInfoResponse>, Status> {
        crate::metadata::log(&request);
        Ok(Response::new(GetInfoResponse {
            instance_id: self.identity.instance_id.clone(),
            release: self.identity.release_version.clone(),
            build_id: self.identity.build_id.clone(),
            protocol_version: self.identity.protocol_version,
            boot_id: facts::boot_id(),
            started_at: Some(machine_core::time::timestamp(crate::daemon::started_at())),
            facts: Some(facts::facts()),
            capabilities: capabilities().await,
        }))
    }
}

/// What the box can do: the shells and `git` with their versions, when on `PATH`.
async fn capabilities() -> Vec<machine_protocol::bootstrap::v1::Capability> {
    let mut capabilities = Vec::new();
    for tool in ["bash", "zsh", "git"] {
        if std::env::var_os("PATH")
            .is_some_and(|path| std::env::split_paths(&path).any(|dir| dir.join(tool).is_file()))
        {
            capabilities.push(machine_protocol::bootstrap::v1::Capability {
                name: tool.to_owned(),
                version: tool_version(tool).await,
            });
        }
    }
    capabilities
}

/// The first dotted number in `<tool> --version`, as a semantic version.
async fn tool_version(tool: &str) -> String {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::process::Command::new(tool)
            .arg("--version")
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let Ok(Ok(output)) = output else {
        return String::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.split(|c: char| c.is_whitespace() || c == '(' || c == ')' || c == '-')
        .find(|word| {
            word.split('.').count() >= 2 && word.split('.').all(|part| part.parse::<u32>().is_ok())
        })
        .map(|word| {
            let mut parts: Vec<&str> = word.split('.').collect();
            parts.truncate(3);
            while parts.len() < 3 {
                parts.push("0");
            }
            parts.join(".")
        })
        .unwrap_or_default()
}

struct Machine {
    context: Context,
}

#[tonic::async_trait]
impl MachineService for Machine {
    async fn list_roots(
        &self,
        request: Request<ListRootsRequest>,
    ) -> Result<Response<ListRootsResponse>, Status> {
        crate::metadata::log(&request);
        let config = self.context.config.current();
        let roots = config
            .roots
            .iter()
            .map(|root| Root {
                path: root.clone(),
                filesystem_bytes: facts::disk_total_bytes(root),
            })
            .collect();
        Ok(Response::new(ListRootsResponse { roots }))
    }

    async fn get_limits(
        &self,
        request: Request<GetLimitsRequest>,
    ) -> Result<Response<GetLimitsResponse>, Status> {
        crate::metadata::log(&request);
        let limits = self.context.limits();
        Ok(Response::new(GetLimitsResponse {
            limits: Some(Limits {
                max_running_jobs: limits.max_running_jobs,
                max_job_output_bytes: limits.job_output_bytes,
            }),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::tool_version;
    use std::{fs, os::unix::fs::PermissionsExt, time::Instant};

    #[tokio::test]
    async fn hung_version_probe_times_out() {
        let dir = tempfile::tempdir().unwrap();
        let command = dir.path().join("hung-version");
        fs::write(&command, "#!/bin/sh\nexec sleep 10\n").unwrap();
        fs::set_permissions(&command, fs::Permissions::from_mode(0o700)).unwrap();

        let started = Instant::now();
        assert!(tool_version(command.to_str().unwrap()).await.is_empty());
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }
}
