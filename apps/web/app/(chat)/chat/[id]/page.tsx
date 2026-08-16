import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { ChatPage } from "../../components/chat-page";
import { draftPhaseFromSearchParam } from "@/lib/services/chat/draft-route";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";
import {
  fetchDraftChatMessages,
  fetchInitialChatMessages,
} from "@/lib/services/chat/server";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ draft?: string | string[] }>;
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
      <ChatPage
        chatId={id}
        initialChatExists={initialMessages !== null}
        initialDraftPhase={draftPhase}
      />
    </HydrationBoundary>
  );
}
