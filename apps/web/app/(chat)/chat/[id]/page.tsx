import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { ChatPage } from "../../components/chat-page";
import { fetchInitialChatMessages } from "@/lib/services/chat/server";
import { seedChatMessagesQueryData } from "@/lib/services/chat/queries";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const initialMessages = await fetchInitialChatMessages(id);
  const queryClient = new QueryClient();

  seedChatMessagesQueryData(queryClient, id, initialMessages);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ChatPage chatId={id} />
    </HydrationBoundary>
  );
}
