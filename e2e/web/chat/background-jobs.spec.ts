import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { readyComposer } from "../../support/composer";
import { expect, test } from "../../support/fixtures";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.E2E_API_PORT ?? "4301"}`;

type Job = {
  id: string;
  locator: string;
  state:
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "lost";
  stoppedBy: string | null;
};

type JobsResponse = { items: Array<Job> };

type MessagesResponse = {
  messages: Array<{
    id: string;
    role: string;
    host: boolean;
    senderUserId: string | null;
  }>;
  latestRun: { id: string } | null;
};

type RunResponse = { status: string };

test("a settled background job starts a host Run and the Jobs panel stops a live job", async ({
  page,
  account,
}) => {
  test.setTimeout(90_000);
  const token = `background-${randomUUID()}`;
  const firstStartedPath = `/tmp/llame-e2e-background-${token}-first-started`;
  const secondStartedPath = `/tmp/llame-e2e-background-${token}-second-started`;
  const releasePath = `/tmp/llame-e2e-background-${token}-release`;
  let chatId: string | undefined;
  let firstJob: Job | undefined;
  let secondJob: Job | undefined;

  const headers = { Authorization: `Bearer ${account.token}` };

  const listJobs = async (): Promise<JobsResponse> => {
    if (!chatId) throw new Error("The test Chat has not been created");

    const response = await page.request.get(
      `${apiUrl}/api/v1/chats/${chatId}/jobs`,
      { headers },
    );

    if (!response.ok()) {
      throw new Error(
        `Jobs API returned ${response.status()}: ${await response.text()}`,
      );
    }

    // SAFETY: this successful response is the owned jobs endpoint's JSON contract.
    return (await response.json()) as JobsResponse;
  };

  const readMessages = async (): Promise<MessagesResponse> => {
    if (!chatId) throw new Error("The test Chat has not been created");

    const response = await page.request.get(
      `${apiUrl}/api/v1/chats/${chatId}/messages`,
      { headers },
    );

    if (!response.ok()) {
      throw new Error(
        `Messages API returned ${response.status()}: ${await response.text()}`,
      );
    }

    // SAFETY: this successful response is the owned history endpoint's JSON contract.
    return (await response.json()) as MessagesResponse;
  };

  const readRun = async (runId: string): Promise<RunResponse> => {
    const response = await page.request.get(`${apiUrl}/api/v1/runs/${runId}`, {
      headers,
    });

    if (!response.ok()) {
      throw new Error(
        `Run API returned ${response.status()}: ${await response.text()}`,
      );
    }

    // SAFETY: this successful response is the owned Run endpoint's JSON contract.
    return (await response.json()) as RunResponse;
  };

  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const composer = await readyComposer(page);
    await composer.fill(
      `background jobs notice e2e BACKGROUND_JOB_TOKEN:${token}`,
    );
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/u, {
      timeout: 15_000,
    });
    chatId = new URL(page.url()).pathname.split("/").at(-1);

    if (!chatId) throw new Error("The Chat URL did not contain an id");

    await expect
      .poll(() => existsSync(firstStartedPath), { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(async () => {
        const jobs = await listJobs();
        firstJob = jobs.items.find((job) => job.state === "running");

        return firstJob?.state;
      })
      .toBe("running");

    // The first host command cannot settle until this test releases its
    // filesystem barrier, so the owner Run and the notice Run stay distinct.
    const ownerRunId = (await readMessages()).latestRun?.id;

    if (!ownerRunId) throw new Error("The owner Run was not persisted");
    await expect
      .poll(async () => (await readRun(ownerRunId)).status)
      .toBe("completed");

    writeFileSync(releasePath, "release");
    await expect
      .poll(async () => {
        const jobs = await listJobs();
        firstJob = jobs.items.find((job) => job.id === firstJob?.id);

        return firstJob?.state;
      })
      .toBe("succeeded");

    const hostReply = page
      .getByRole("log")
      .getByText(`BACKGROUND_JOB_HOST_RUN_E2E:${token}`, { exact: false });

    await expect(hostReply).toBeVisible({ timeout: 30_000 });
    const noticeRun = (await readMessages()).latestRun?.id;

    if (!noticeRun)
      throw new Error("The settlement notice Run was not persisted");
    expect(noticeRun).not.toBe(ownerRunId);
    expect(
      (await readMessages()).messages.filter((message) => message.host),
      "The notice must be delivered on a host-authored message, not an owner bubble",
    ).toHaveLength(1);

    const secondComposer = await readyComposer(page);
    await secondComposer.fill(
      `background jobs stop e2e BACKGROUND_JOB_TOKEN:${token}`,
    );
    await page.getByRole("button", { name: "Send message" }).click();
    await expect
      .poll(() => existsSync(secondStartedPath), { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(async () => {
        const jobs = await listJobs();
        secondJob = jobs.items.find(
          (job) => job.id !== firstJob?.id && job.state === "running",
        );

        return secondJob?.state;
      })
      .toBe("running");

    const secondRunId = (await readMessages()).latestRun?.id;

    if (!secondRunId) throw new Error("The second owner Run was not persisted");
    expect(secondRunId).not.toBe(noticeRun);
    await expect
      .poll(async () => (await readRun(secondRunId)).status)
      .toBe("completed");

    const showDetails = page.getByRole("button", {
      name: "Show session details",
    });

    if (await showDetails.isVisible()) await showDetails.click();

    const jobStop = page.getByRole("button", {
      name: `Stop ${secondJob?.locator}`,
    });

    const jobsToggle = page.getByRole("button", { name: /^Jobs/u });

    if ((await jobsToggle.getAttribute("aria-expanded")) !== "true") {
      await jobsToggle.click();
    }

    await expect(jobStop).toBeVisible({ timeout: 10_000 });
    await jobStop.click();

    await expect
      .poll(async () => {
        const jobs = await listJobs();
        secondJob = jobs.items.find((job) => job.id === secondJob?.id);

        return secondJob?.state;
      })
      .toBe("cancelled");
    expect(secondJob?.stoppedBy).toBe("owner");

    // The authenticated history projection exposes its newest durable Run;
    // cancelling the job must not start a settlement-notice Run.
    const afterStop = await readMessages();
    expect(afterStop.latestRun?.id).toBe(secondRunId);
    expect(afterStop.messages.filter((message) => message.host)).toHaveLength(
      1,
    );
    rmSync(firstStartedPath, { force: true });
    rmSync(secondStartedPath, { force: true });
  } finally {
    writeFileSync(releasePath, "release");

    if (chatId) {
      const jobs = await listJobs().catch(() => ({ items: [] }));

      for (const job of jobs.items.filter((item) => item.state === "running")) {
        await page.request
          .patch(`${apiUrl}/api/v1/chats/${chatId}/jobs/${job.id}`, {
            headers,
            data: { state: "cancelled" },
          })
          .catch(() => undefined);
      }
    }

    rmSync(firstStartedPath, { force: true });
    rmSync(secondStartedPath, { force: true });
    rmSync(releasePath, { force: true });
  }
});
