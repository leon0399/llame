//! Generated code for `stead.machine.v1` and `stead.machine.bootstrap.v1`.

pub mod bootstrap {
    #[allow(clippy::all, clippy::pedantic, clippy::nursery)]
    pub mod v1 {
        tonic::include_proto!("stead.machine.bootstrap.v1");
    }
}

#[allow(clippy::all, clippy::pedantic, clippy::nursery)]
pub mod v1 {
    tonic::include_proto!("stead.machine.v1");
}

include!(concat!(env!("OUT_DIR"), "/protocol_version.rs"));
