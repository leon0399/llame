import { type CallOptions, type Client } from '@connectrpc/connect';
import { JobService } from '@workspace/machine-protocol';
import { type ChatJob } from '../db/schema';
import type { MachineRequestOptions } from '../machines/machine-session';

type JobsClient = Client<typeof JobService>;

type JobsCallOptions = (options?: MachineRequestOptions) => CallOptions;

export async function releaseDaemonJob(deps: {
  client: JobsClient;
  callOptions: JobsCallOptions;
  row: ChatJob;
}): Promise<void> {
  const { client, callOptions, row } = deps;
  await client.deleteJob(
    {
      requestId: row.daemonJobId,
      jobId: row.daemonJobId,
      owner: row.ownerUserId,
    },
    callOptions(),
  );
}

export async function stopDaemonJob(deps: {
  connector: {
    jobsClient(
      machineName: string,
    ): Promise<{ client: JobsClient; callOptions: JobsCallOptions }>;
  };
  machineName: string;
  row: ChatJob;
}): Promise<void> {
  const { connector, machineName, row } = deps;

  try {
    const { client, callOptions } = await connector.jobsClient(machineName);
    await client.cancelJob(
      {
        requestId: row.daemonJobId,
        jobId: row.daemonJobId,
        owner: row.ownerUserId,
      },
      callOptions(),
    );
  } catch {
    // The committed request is delivered by the next Watch snapshot.
  }
}
