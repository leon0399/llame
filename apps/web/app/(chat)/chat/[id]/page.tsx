import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { ChatPage } from "../../components/chat-page";
import { draftPhaseFromSearchParam } from "@/lib/services/chat/draft-route";
import { PREHYDRATION_PIN_SCRIPT } from "@/lib/services/chat/prehydration-pin";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";
import {
  fetchDraftChatMessages,
  fetchInitialChatMessages,
} from "@/lib/services/chat/server";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ draft?: string | Array<string> }>;
};

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const draftPhase = draftPhaseFromSearchParam((await searchParams).draft);
  const initialMessages =
    draftPhase === null
      ? await fetchInitialChatMessages(id)
      : await fetchDraftChatMessages(id, draftPhase);
  const queryClient = new QueryClient();

  if (initialMessages !== null) {
    seedChatMessagesQueryData(queryClient, id, initialMessages);
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* Streams ahead of the transcript markup so the SSR paint is pinned
          to the newest message from the first frame — React cannot scroll
          until it hydrates (see prehydration-pin.ts). */}
      {/* safe-html: PREHYDRATION_PIN_SCRIPT is a module-level constant string
          literal in lib/services/chat/prehydration-pin.ts. It interpolates
          nothing — no chat id, no message, no parameter. */}
      <script dangerouslySetInnerHTML={{ __html: PREHYDRATION_PIN_SCRIPT }} />
      <ChatPage
        chatId={id}
        initialChatExists={initialMessages !== null}
        initialDraftPhase={draftPhase}
      />
    </HydrationBoundary>
  );
}
