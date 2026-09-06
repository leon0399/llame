# Node clients

Reusable private-IPC and authenticated HTTP clients extracted from the terminal.
`NodeAccessClient` validates capabilities and owner-bound observations for both
transports. Local launch, remote session storage, and durable event cursors retain
separate responsibilities. This package does not open SQLite, execute model/tools,
or import hosted implementation classes.

See [common access](../../docs/node/shared-access.md). Its common operation layer
is not a claim that all hosted REST and private execution methods are equivalent.
Tests use real IPC/HTTP plus controlled backend ports; production API/RLS and MCP
transport acceptance have their own suites.
