import { redirect } from "next/navigation";

import { projectStartRedirect } from "@/lib/services/project/start-location-link";

type SearchParams = Record<string, string | Array<string> | undefined>;

/**
 * The deep link every chat-start entry point shares (openspec
 * `chat-start-location`, design D10):
 *
 *   /chat/new?project=&repository=&executor=&checkout=&worktree=1
 *
 * A named project forwards to that project's composer with the same pre-fill,
 * because the project page owns the chip the create is composed with. Without
 * a project there is nothing to pre-fill, so the root's ordinary new-chat
 * redirect applies.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const destination = projectStartRedirect(await searchParams);
  redirect(destination ?? "/");
}
