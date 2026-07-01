import { ChatPage } from "../../components/chat-page";
import { fetchInitialChatMessages } from "@/lib/services/chat/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const initialMessages = await fetchInitialChatMessages(id);

  return <ChatPage chatId={id} initialMessages={initialMessages} />;
}
