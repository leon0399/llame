import { redirect } from "next/navigation";
import { connection } from "next/server";

import { draftChatPath } from "@/lib/services/chat/draft-route";

export default async function Page() {
  await connection();
  redirect(draftChatPath(crypto.randomUUID(), "fresh"));
}
