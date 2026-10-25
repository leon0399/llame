"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import { cn } from "@workspace/ui/lib/utils";
import { BookMarkedIcon, FolderPlusIcon } from "lucide-react";

import { useRegisterCheckout } from "@/lib/services/checkouts/mutations";
import { useCheckoutsQuery } from "@/lib/services/checkouts/queries";
import { useLinkProjectRepository } from "@/lib/services/project/mutations";
import { repositoryFailureMessage } from "@/lib/services/repositories/failure";
import {
  useRepositoriesQuery,
  type RepositoryResponse,
} from "@/lib/services/repositories/queries";

import { Refusal } from "./project-repository-dialogs";

type AddRepositoryProps = {
  projectId: string;
  linkedRepositoryIds: ReadonlySet<string>;
};

/** What the search box holds reads as a path — absolute, or a Machine
 *  locator — rather than a name to search for. Registration takes only those
 *  two forms, so `~/` and relative paths stay searches. */
function looksLikePath(query: string) {
  return query.startsWith("/") || query.startsWith("machine://");
}

/** A pasted path as checkouts store it: no trailing separator. */
function checkoutPath(path: string) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** The repository a pasted path belongs to. A path that is already one of
 *  the account's checkouts names that checkout's repository, since
 *  registering it again is refused; any other path registers first. */
function usePathRepository() {
  const register = useRegisterCheckout();
  const checkouts = useCheckoutsQuery();
  const resolve = async (path: string) => {
    const known = checkouts.data?.find(
      (checkout) => checkout.path === checkoutPath(path),
    );
    return (
      known?.repositoryId ?? (await register.mutateAsync({ path })).repositoryId
    );
  };
  return { resolve, pending: register.isPending };
}

/**
 * The two writes behind the picker. A catalog repository links as it is; a
 * path links the repository it belongs to, unless the project already links
 * it. The first link a project takes is its primary, so a one-repository
 * project never asks what "primary" means.
 */
function useAddRepository(
  { projectId, linkedRepositoryIds }: AddRepositoryProps,
  onDone: () => void,
) {
  const link = useLinkProjectRepository();
  const pathRepository = usePathRepository();
  const [failure, setFailure] = useState<string | null>(null);
  const linkRepository = async (repositoryId: string) => {
    await link.mutateAsync({
      projectId,
      repositoryId,
      isPrimary: linkedRepositoryIds.size === 0,
    });
  };
  const run = async (write: () => Promise<void>, fallback: string) => {
    setFailure(null);
    try {
      await write();
      onDone();
    } catch (error) {
      setFailure(repositoryFailureMessage(error, fallback));
    }
  };
  return {
    failure,
    pending: link.isPending || pathRepository.pending,
    link: (repositoryId: string) =>
      run(() => linkRepository(repositoryId), "Couldn't link the repository."),
    addPath: (path: string) =>
      run(async () => {
        const repositoryId = await pathRepository.resolve(path);
        if (!linkedRepositoryIds.has(repositoryId)) {
          await linkRepository(repositoryId);
        }
      }, "Couldn't add the repository."),
  };
}

/** The cmdk value of a catalog option; also what its search matches. */
function optionValue(repository: RepositoryResponse) {
  // cmdk trims item values, so an untrimmed value never matches the active one.
  return `${repository.displayName} ${repository.canonicalRemote ?? ""}`.trim();
}

function RepositoryOption({
  repository,
  disabled,
  onSelect,
}: {
  repository: RepositoryResponse;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={optionValue(repository)}
      disabled={disabled}
      onSelect={onSelect}
    >
      <BookMarkedIcon />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{repository.displayName}</span>
        <span className="truncate text-xs text-muted-foreground">
          {repository.canonicalRemote ?? "No remote"}
        </span>
      </span>
    </CommandItem>
  );
}

/** The account's repositories this project does not link yet, narrowed by
 *  the search text; none while the text reads as a path. */
function useCatalogMatches(
  linkedRepositoryIds: ReadonlySet<string>,
  query: string,
) {
  const catalog = useRepositoriesQuery().data ?? [];
  if (looksLikePath(query)) return [];
  const needle = query.toLowerCase();
  return catalog.filter(
    (repository) =>
      !linkedRepositoryIds.has(repository.id) &&
      optionValue(repository).toLowerCase().includes(needle),
  );
}

/** The pasted path, as the one option that adds it. */
function PathGroup({
  path,
  disabled,
  onSelect,
}: {
  path: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandGroup heading="Add a clone">
      <CommandItem
        value={`path:${path}`}
        disabled={disabled}
        onSelect={onSelect}
      >
        <FolderPlusIcon />
        <span className="truncate font-mono text-xs">{path}</span>
      </CommandItem>
    </CommandGroup>
  );
}

/** The options under the draft: a pasted path, or the catalog matches. */
function DraftOptions({
  query,
  matches,
  disabled,
  onLink,
  onAddPath,
}: {
  query: string;
  matches: ReadonlyArray<RepositoryResponse>;
  disabled: boolean;
  onLink: (repositoryId: string) => void;
  onAddPath: (path: string) => void;
}) {
  return (
    <CommandList
      // Keeps focus in the draft's field while an option is clicked, so
      // the field's blur does not close the draft before the click lands.
      onMouseDown={(event) => event.preventDefault()}
    >
      {looksLikePath(query) ? (
        <PathGroup
          path={query}
          disabled={disabled}
          onSelect={() => onAddPath(query)}
        />
      ) : (
        <CommandGroup heading="Your repositories">
          {matches.map((repository) => (
            <RepositoryOption
              key={repository.id}
              repository={repository}
              disabled={disabled}
              onSelect={() => onLink(repository.id)}
            />
          ))}
        </CommandGroup>
      )}
    </CommandList>
  );
}

/** The row's second line, where a linked row shows its remote: what the
 *  field will do with what it holds. */
function draftStatus(search: string, matches: number): string {
  if (search === "") return "Search your repositories, or paste a path";
  if (looksLikePath(search)) return "Enter adds this clone";
  if (matches === 0) return "No match. Paste a path to add a clone";
  return matches === 1 ? "1 match" : `${matches} matches`;
}

/** A refusal inside a draft's floating box, inset from its edges. */
export function DraftFailure({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div className="p-2">
      <Refusal message={message} />
    </div>
  );
}

/** The draft's field, borderless so the row reads as a row being named
 *  rather than a form. It takes focus as the draft appears, since the `+`
 *  that added the draft is a request to type. */
type DraftFieldProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onCancel: () => void;
  cancelOnBlur: boolean;
  /** Enter's own action, for a draft without options to pick. */
  onEnter?: () => void;
  placeholder: string;
  label: string;
  /** Set where the list's rows show paths in the code face. */
  monospace?: boolean;
  /** Set inside a Command whose options the field picks from, so it is
   *  announced as a combobox over them. */
  combobox?: boolean;
};

/** What both forms of the field share: focus on appearing, Escape and an
 *  empty blur to discard, and Enter's own action. */
function useDraftFieldBehavior({
  query,
  onCancel,
  cancelOnBlur,
  onEnter,
  placeholder,
  label,
}: Omit<DraftFieldProps, "onQueryChange" | "monospace" | "combobox">) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  return {
    ref: field,
    value: query,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        // The draft's Escape, not the enclosing sheet's: unstopped, it
        // reaches the dialog and closes it too.
        event.stopPropagation();
        onCancel();
      }
      if (event.key === "Enter") onEnter?.();
    },
    onBlur: () => {
      if (cancelOnBlur) onCancel();
    },
    placeholder,
    "aria-label": label,
    spellCheck: false,
  };
}

export function DraftField({
  onQueryChange,
  monospace = false,
  combobox = false,
  ...props
}: DraftFieldProps) {
  const shared = useDraftFieldBehavior(props);
  if (combobox) {
    return (
      <CommandInput
        variant="inline"
        onValueChange={onQueryChange}
        {...shared}
      />
    );
  }
  return (
    <input
      {...shared}
      onChange={(event) => onQueryChange(event.target.value)}
      autoComplete="off"
      className={cn(
        "w-full min-w-0 bg-transparent text-sm outline-none placeholder:font-sans placeholder:font-normal placeholder:text-muted-foreground",
        monospace ? "font-mono" : "font-medium",
      )}
    />
  );
}

/** A draft row's two lines, framed like a list row that is being edited:
 *  the field, then what Enter will do with what it holds. */
export function DraftLines({
  status,
  icon,
  children,
}: {
  status: string;
  /** The leading icon of the list the draft joins, so its text lines up. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md bg-accent px-2 py-1.5">
      {icon}
      <div className="flex min-w-0 flex-1 flex-col">
        {children}
        <span className="truncate text-xs text-muted-foreground">{status}</span>
      </div>
    </div>
  );
}

/** What floats under a draft row — its options, its refusal — so typing never
 *  resizes the list. Its parent is the positioned row. */
export function DraftFloat({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
      {children}
    </div>
  );
}

/** The options and any refusal, floating under the row so typing never
 *  resizes the section. Nothing floats while there is nothing to choose. */
function DraftPopout({
  search,
  matches,
  add,
}: {
  search: string;
  matches: ReadonlyArray<RepositoryResponse>;
  add: ReturnType<typeof useAddRepository>;
}) {
  const hasOptions = looksLikePath(search) || matches.length > 0;
  if (!hasOptions && add.failure === null) return null;
  return (
    <DraftFloat>
      {hasOptions ? (
        <DraftOptions
          query={search}
          matches={matches}
          disabled={add.pending}
          onLink={(repositoryId) => void add.link(repositoryId)}
          onAddPath={(path) => void add.addPath(path)}
        />
      ) : null}
      <DraftFailure message={add.failure} />
    </DraftFloat>
  );
}

/**
 * The option Enter picks. Unfiltered, cmdk does not move its selection as the
 * options change, so Enter would pick nothing: a pasted path is always the
 * active option, and otherwise the pointed-at match, or the first one.
 */
function useActiveOption(
  search: string,
  matches: ReadonlyArray<RepositoryResponse>,
) {
  const [active, setActive] = useState("");
  if (looksLikePath(search)) return [`path:${search}`, setActive] as const;
  const values = matches.map(optionValue);
  if (values.includes(active)) return [active, setActive] as const;
  return [values[0] ?? "", setActive] as const;
}

/**
 * The row the section's `+` adds to its own list, laid out like the linked
 * rows above it: a name line that takes typing, and a second line that says
 * what Enter will do. It searches the account's repositories and takes a
 * pasted path. Escape, or leaving the empty field, discards the draft.
 *
 * @summary add a repository to a project inline, from the catalog or by path
 */
export function DraftRepositoryRow({
  onClose,
  ...props
}: AddRepositoryProps & { onClose: () => void }) {
  const add = useAddRepository(props, onClose);
  const [query, setQuery] = useState("");
  const search = query.trim();
  const matches = useCatalogMatches(props.linkedRepositoryIds, search);
  const [activeValue, setActive] = useActiveOption(search, matches);

  return (
    <li className="-mx-2">
      {/* The command clips its content by default, which would cut the
          floating options below the row. */}
      <Command
        shouldFilter={false}
        value={activeValue}
        onValueChange={setActive}
        label="Add repository"
        className="relative overflow-visible"
      >
        <DraftLines status={draftStatus(search, matches.length)}>
          <DraftField
            query={query}
            onQueryChange={setQuery}
            onCancel={onClose}
            cancelOnBlur={search === "" && !add.pending}
            placeholder="Repository name or path"
            label="Add repository"
            combobox
          />
        </DraftLines>
        <DraftPopout search={search} matches={matches} add={add} />
      </Command>
    </li>
  );
}
