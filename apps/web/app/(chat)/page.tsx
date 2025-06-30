import { Button } from "@workspace/ui/components/button"
import { ChatHeader } from "./components/chat-header"

export default function Page() {
  return (
    <div className="flex flex-col min-w-0 h-dvh bg-background">
      <ChatHeader />
    </div>
  )
}
