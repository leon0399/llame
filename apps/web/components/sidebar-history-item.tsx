import type { Chat } from '@/lib/db/schema';
import {
  SidebarInput,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import {
  CheckCircleFillIcon,
  GlobeIcon,
  LockIcon,
  MoreHorizontalIcon,
  ShareIcon,
  TrashIcon,
  PencilEditIcon,
  // SparklesIcon,
} from './icons';
import { memo, useEffect, useRef, useState } from 'react';
import { useOnClickOutside } from 'usehooks-ts';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { useSWRConfig } from 'swr';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey, type ChatHistory } from './sidebar-history';
import { toast } from 'sonner';

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  setOpenMobile,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  setOpenMobile: (open: boolean) => void;
}) => {
  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId: chat.id,
    initialVisibilityType: chat.visibility,
  });
  const { mutate } = useSWRConfig();

  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(chat.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraftTitle(chat.title);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing, chat.title]);

  useOnClickOutside(formRef, () => {
    if (isEditing) {
      setDraftTitle(chat.title);
      setIsEditing(false);
    }
  });

  const submitRename = async (newTitle: string) => {
    const renamePromise = fetch(`/api/chat/${chat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });

    await toast.promise(renamePromise, {
      loading: 'Updating title...',
      success: async () => {
        await mutate(
          unstable_serialize(getChatHistoryPaginationKey),
          (history?: Array<ChatHistory>) =>
            history?.map((page) => ({
              ...page,
              chats: page.chats.map((c) =>
                c.id === chat.id ? { ...c, title: newTitle } : c,
              ),
            })),
          { revalidate: false },
        );
        return 'Chat title updated';
      },
      error: 'Failed to update title',
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const newTitle = draftTitle.trim();
    if (!newTitle) {
      setIsEditing(false);
      return;
    }
    await submitRename(newTitle);
    setIsEditing(false);
  };

  return (
    <SidebarMenuItem>
      {isEditing ? (
        <form ref={formRef} onSubmit={handleSubmit} className="w-full relative">
          <SidebarInput
            ref={inputRef}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            // className="pr-7"
          />
          {/* <SidebarMenuAction
            type='button'
          >
            <SparklesIcon />
            <span className="sr-only">Generate</span>
          </SidebarMenuAction> */}
        </form>
      ) : (
        <>
          <SidebarMenuButton asChild isActive={isActive}>
            <Link href={`/chat/${chat.id}`} onClick={() => setOpenMobile(false)}>
              <span>{chat.title}</span>
            </Link>
          </SidebarMenuButton>

          <DropdownMenu modal={true}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground mr-0.5"
                showOnHover={!isActive}
              >
                <MoreHorizontalIcon />
                <span className="sr-only">More</span>
              </SidebarMenuAction>
            </DropdownMenuTrigger>

            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="cursor-pointer">
                  <ShareIcon />
                  <span>Share</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      className="cursor-pointer flex-row justify-between"
                      onClick={() => {
                        setVisibilityType('private');
                      }}
                    >
                      <div className="flex flex-row gap-2 items-center">
                        <LockIcon size={12} />
                        <span>Private</span>
                      </div>
                      {visibilityType === 'private' ? (
                        <CheckCircleFillIcon />
                      ) : null}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer flex-row justify-between"
                      onClick={() => {
                        setVisibilityType('public');
                      }}
                    >
                      <div className="flex flex-row gap-2 items-center">
                        <GlobeIcon />
                        <span>Public</span>
                      </div>
                      {visibilityType === 'public' ? <CheckCircleFillIcon /> : null}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => setIsEditing(true)}
              >
                <PencilEditIcon />
                <span>Rename</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-red-500"
                onSelect={() => onDelete(chat.id)}
              >
                <TrashIcon />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </SidebarMenuItem>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) return false;
  if (prevProps.chat.title !== nextProps.chat.title) return false;
  return true;
});
