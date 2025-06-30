import { ChatHeader } from "./components/chat-header"
import { ChatSidebar } from "./components/chat-sidebar"

export default function Page() {
  return (
    <>
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <ChatHeader />
      </div>
    </>
  )
}
