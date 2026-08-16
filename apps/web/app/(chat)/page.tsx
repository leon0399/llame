import { redirect } from "next/navigation";

import { draftChatPath } from "@/lib/services/chat/draft-route";

export default function Page() {
  redirect(draftChatPath(crypto.randomUUID(), "fresh"));
}
