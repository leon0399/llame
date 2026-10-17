import type { ComponentProps } from "react";
import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { Button } from "@workspace/ui/components/button";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";

import {
  emptyResponse,
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import {
  CreateProjectForChatDialog,
  DeleteProjectDialog,
  EditProjectDialog,
  NewProjectDialog,
} from "./project-dialogs";

// No hook mocking: the real project mutations (and useFileChat) run against a
// stubbed globalThis.fetch. The create POST and the delete DELETE are held
// until a story releases them, so a story can observe the dialog while the
// request is still in flight and prove what is (not yet) sent. The edit and
// chat-filing PATCHes succeed at once. An unrouted request is recorded and
// the meta's afterEach fails the story on it: the throw alone would only
// reach the hook's onError toast.
let fetchMock: Mock<typeof fetch>;
let unrouted: Array<string>;
let releaseCreate: () => void;
let releaseDelete: () => void;

const project = {
  id: "p1",
  name: "Acme relaunch",
  description: "Everything about the relaunch",
};

function routeFetch() {
  return () => {
    fetchMock = stubFetch();
    unrouted = [];
    fetchMock.mockImplementation((input) => {
      const request = input instanceof Request ? input : new Request(input);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      if (key === "POST /api/v1/projects") {
        return new Promise<Response>((resolve) => {
          releaseCreate = () =>
            resolve(jsonResponse({ id: "p1", name: "New Co" }));
        });
      }
      if (key === "PATCH /api/v1/projects/p1") {
        return Promise.resolve(jsonResponse({ id: "p1", name: "Renamed" }));
      }
      if (key === "DELETE /api/v1/projects/p1") {
        return new Promise<Response>((resolve) => {
          releaseDelete = () => resolve(emptyResponse());
        });
      }
      if (key === "PATCH /api/v1/chats/c1") {
        return Promise.resolve(emptyResponse());
      }
      unrouted.push(key);
      throw new Error(`unrouted fetch in story: ${key}`);
    });
    return () => {
      vi.unstubAllGlobals();
    };
  };
}

/** Wait for the named dialog to finish fading in and return it. */
async function openedDialog(role: "dialog" | "alertdialog", name: string) {
  // The dialog portals into document.body, outside the story canvas.
  const dialog = await screen.findByRole(role, { name });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog);
}

/** The `index`th request the dialog sent, once it has been sent. */
async function sentRequest(index = 0) {
  return waitFor(() => requestFromCall(fetchMock, index));
}

/** "METHOD /path" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => {
    const request = input instanceof Request ? input : new Request(input);
    return `${request.method} ${new URL(request.url).pathname}`;
  });
}

const meta = {
  component: NewProjectDialog,
  subcomponents: {
    CreateProjectForChatDialog,
    EditProjectDialog,
    DeleteProjectDialog,
  },
  tags: ["autodocs"],
  args: {
    open: true,
    onOpenChange: fn(),
  },
  beforeEach: routeFetch(),
  afterEach: async () => {
    await expect(unrouted).toEqual([]);
  },
} satisfies Meta<typeof NewProjectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;
type ForChatStory = StoryObj<typeof CreateProjectForChatDialog>;
type EditStory = StoryObj<typeof EditProjectDialog>;
type DeleteStory = StoryObj<typeof DeleteProjectDialog>;

/**
 * Creating a project POSTs its name and description; Create stays disabled
 * and the dialog stays open until the server answers, then the dialog closes.
 *
 * @summary new project: Create sends both fields and closes once created
 */
export const Create: Story = {
  tags: ["ai-generated"],
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "New project");
    const name = dialog.getByLabelText("Name");
    const create = dialog.getByRole("button", { name: "Create" });
    await expect(name).toHaveValue("");
    await expect(dialog.getByLabelText("Description")).toHaveValue("");
    await expect(create).toBeDisabled();

    await userEvent.type(name, "New Co");
    await userEvent.type(dialog.getByLabelText("Description"), "Launch prep");
    await userEvent.click(create);

    const request = await sentRequest();
    await expect(sentRoutes()).toEqual(["POST /api/v1/projects"]);
    await expect(request.clone().json()).resolves.toEqual({
      name: "New Co",
      description: "Launch prep",
    });
    await waitFor(() => expect(create).toBeDisabled());
    await expect(args.onOpenChange).not.toHaveBeenCalled();

    releaseCreate();

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    await expect(fetchMock).toHaveBeenCalledTimes(1);
  },
};

/**
 * A blank or spaces-only name keeps Create disabled, and Enter in the field
 * sends nothing either; Enter with a real name creates the project, with no
 * description when none was written.
 *
 * @summary new project: a blank name is never sent, even via Enter
 */
export const CreateBlank: Story = {
  tags: ["ai-generated"],
  play: async () => {
    const dialog = await openedDialog("dialog", "New project");
    const field = dialog.getByLabelText("Name");

    await userEvent.type(field, "   ");
    await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
    await userEvent.keyboard("{Enter}");

    await userEvent.clear(field);
    await userEvent.type(field, "Real name{Enter}");

    // Had the blank Enter been sent, it would be the first request.
    const request = await sentRequest();
    await expect(sentRoutes()).toEqual(["POST /api/v1/projects"]);
    await expect(request.clone().json()).resolves.toEqual({
      name: "Real name",
      description: null,
    });
    releaseCreate();
  },
};

/**
 * Stands in for the sidebar's "New project" button that owns the dialog.
 */
function NewProjectFromSidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New project</Button>
      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Each time the dialog opens, both fields start blank: a cancelled draft is
 * gone.
 *
 * @summary new project: reopening starts from blank fields
 */
export const CreateReopen: Story = {
  tags: ["ai-generated"],
  render: () => <NewProjectFromSidebar />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "New project" }));
    let dialog = await openedDialog("dialog", "New project");
    await userEvent.type(dialog.getByLabelText("Name"), "Draft");
    await userEvent.type(dialog.getByLabelText("Description"), "Notes");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(canvas.getByRole("button", { name: "New project" }));

    dialog = await openedDialog("dialog", "New project");
    await expect(dialog.getByLabelText("Name")).toHaveValue("");
    await expect(dialog.getByLabelText("Description")).toHaveValue("");
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Stands in for the chat list: one shared dialog, opened for a chat row by its
 * "New project…" filing entry, and closed again by clearing that chat.
 */
function FileIntoNewProject({
  onClose,
}: ComponentProps<typeof CreateProjectForChatDialog>) {
  const [chatId, setChatId] = useState<string | null>(null);
  return (
    <>
      <Button onClick={() => setChatId("c1")}>File into new project</Button>
      <CreateProjectForChatDialog
        chatId={chatId}
        onClose={() => {
          onClose();
          setChatId(null);
        }}
      />
    </>
  );
}

/**
 * The dialog stays closed until a chat asks for it. Creating the project
 * files that chat into it: the chat is moved only after the project exists,
 * into the project the server created.
 *
 * @summary new project for a chat: creates it, then files the chat into it
 */
export const ForChat: ForChatStory = {
  tags: ["ai-generated"],
  args: { chatId: null, onClose: fn() },
  render: (args) => <FileIntoNewProject {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(
      canvas.getByRole("button", { name: "File into new project" }),
    );
    const dialog = await openedDialog("dialog", "New project");
    await userEvent.type(dialog.getByLabelText("Name"), "New Co");
    await userEvent.click(dialog.getByRole("button", { name: "Create" }));

    await sentRequest();
    await expect(sentRoutes()).toEqual(["POST /api/v1/projects"]);

    releaseCreate();

    const fileRequest = await sentRequest(1);
    await expect(sentRoutes()).toEqual([
      "POST /api/v1/projects",
      "PATCH /api/v1/chats/c1",
    ]);
    await expect(fileRequest.clone().json()).resolves.toEqual({
      projectId: "p1",
    });
    await waitFor(() => expect(args.onClose).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};

/**
 * Cancelling closes the dialog without creating a project or moving the chat.
 *
 * @summary new project for a chat: Cancel closes without a request
 */
export const ForChatCancel: ForChatStory = {
  tags: ["ai-generated"],
  args: { chatId: "c1", onClose: fn() },
  render: (args) => <CreateProjectForChatDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "New project");

    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    await expect(args.onClose).toHaveBeenCalled();
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

const editArgs = { project, open: true, onOpenChange: fn() };

/**
 * Both fields start from the project. Saving without touching either closes
 * the dialog and sends nothing.
 *
 * @summary edit details: seeded from the project, an unchanged save sends nothing
 */
export const EditSeed: EditStory = {
  tags: ["ai-generated"],
  args: editArgs,
  render: (args) => <EditProjectDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "Edit details");
    await expect(dialog.getByLabelText("Name")).toHaveValue("Acme relaunch");
    await expect(dialog.getByLabelText("Description")).toHaveValue(
      "Everything about the relaunch",
    );

    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * The API stores a description exactly as written, so a value that carries its
 * own surrounding whitespace must not read as an edit its owner never made:
 * the seed is shown verbatim and an untouched Save still only closes.
 *
 * @summary edit details: an untouched save leaves stored whitespace alone
 */
export const EditUntouchedWhitespace: EditStory = {
  tags: ["ai-generated"],
  args: {
    ...editArgs,
    project: { id: "p1", name: "Acme relaunch", description: "  padded  " },
  },
  render: (args) => <EditProjectDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "Edit details");
    await expect(dialog.getByLabelText("Description")).toHaveValue(
      "  padded  ",
    );

    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Editing both fields PATCHes both in one request and closes the dialog once
 * the server accepts it. The single-field cases are `EditRename` and
 * `EditClearsDescription`.
 *
 * @summary edit details: Save with both fields edited sends both
 */
export const EditChanged: EditStory = {
  tags: ["ai-generated"],
  args: editArgs,
  render: (args) => <EditProjectDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "Edit details");
    const name = dialog.getByLabelText("Name");
    const description = dialog.getByLabelText("Description");

    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.clear(description);
    await userEvent.type(description, "Relaunch notes");

    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    const request = await sentRequest();
    await expect(sentRoutes()).toEqual(["PATCH /api/v1/projects/p1"]);
    await expect(request.clone().json()).resolves.toEqual({
      name: "Renamed",
      description: "Relaunch notes",
    });
  },
};

/**
 * Emptying the description saves it as an explicit null — the stored form of
 * "no description" — and sends only that field: an untouched name is omitted,
 * not echoed back, so a rename that landed elsewhere while the dialog was open
 * survives a save made to edit prose.
 *
 * @summary edit details: an emptied description is sent as null, without the name
 */
export const EditClearsDescription: EditStory = {
  tags: ["ai-generated"],
  args: editArgs,
  render: (args) => <EditProjectDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "Edit details");
    const description = dialog.getByLabelText("Description");

    await userEvent.clear(description);
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    const request = await sentRequest();
    await expect(request.clone().json()).resolves.toEqual({
      description: null,
    });
  },
};

/**
 * The mirror of the case above: editing the name alone sends only the name, so
 * a description that landed elsewhere while the dialog was open is not cleared
 * by a save made to rename.
 *
 * @summary edit details: a name-only edit is sent without the description
 */
export const EditRename: EditStory = {
  tags: ["ai-generated"],
  args: editArgs,
  render: (args) => <EditProjectDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "Edit details");
    const name = dialog.getByLabelText("Name");

    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    const request = await sentRequest();
    await expect(request.clone().json()).resolves.toEqual({ name: "Renamed" });
  },
};

/**
 * Emptying the name disables Save, and Enter in the name field saves nothing
 * and keeps the dialog open: a project always has a name.
 *
 * @summary edit details: an emptied name is never saved, even via Enter
 */
export const EditBlankName: EditStory = {
  tags: ["ai-generated"],
  args: editArgs,
  render: (args) => <EditProjectDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "Edit details");
    const name = dialog.getByLabelText("Name");

    await userEvent.clear(name);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    // Enter in the name field submits directly, past the disabled Save button.
    await userEvent.type(name, "{Enter}");

    await expect(args.onOpenChange).not.toHaveBeenCalled();
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Stands in for the project row that owns the dialog: it opens the dialog from
 * an Edit details button, and "Rename in another tab" replaces the project's
 * name the way a list refetch does after the project was renamed elsewhere.
 */
function EditFromSidebar({
  project: initial,
}: ComponentProps<typeof EditProjectDialog>) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit details</Button>
      <Button variant="outline" onClick={() => setName("Updated elsewhere")}>
        Rename in another tab
      </Button>
      <EditProjectDialog
        project={{ ...initial, name }}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

/**
 * Each time the dialog opens, the fields start from the project as it is
 * then: a cancelled draft is gone, and a name changed while the dialog was
 * closed shows up.
 *
 * @summary edit details: reopening starts from the project's current details
 */
export const EditReopen: EditStory = {
  tags: ["ai-generated"],
  args: editArgs,
  render: (args) => <EditFromSidebar {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Edit details" }));
    let dialog = await openedDialog("dialog", "Edit details");
    await userEvent.clear(dialog.getByLabelText("Name"));
    await userEvent.type(dialog.getByLabelText("Name"), "Draft");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(
      canvas.getByRole("button", { name: "Rename in another tab" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Edit details" }));

    dialog = await openedDialog("dialog", "Edit details");
    await expect(dialog.getByLabelText("Name")).toHaveValue(
      "Updated elsewhere",
    );
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Confirming deletion names the project, DELETEs it, keeps Delete disabled
 * while the request is in flight, and closes the dialog once it lands.
 *
 * @summary delete: sends the DELETE and closes once deleted
 */
export const Delete: DeleteStory = {
  tags: ["ai-generated"],
  args: editArgs,
  // #232 — the confirm button is base-nova's subtle destructive Button
  // (`bg-destructive/10 text-destructive`, ~3.82:1), the tracked low-contrast
  // token defect. Suppress only color-contrast until the token fix lands.
  parameters: contrastKnownIssue232,
  render: (args) => <DeleteProjectDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("alertdialog", "Delete project?");
    await expect(
      dialog.getByText(/“Acme relaunch” will be deleted/),
    ).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Delete" });

    await userEvent.click(confirm);

    await sentRequest();
    await expect(sentRoutes()).toEqual(["DELETE /api/v1/projects/p1"]);
    await waitFor(() => expect(confirm).toBeDisabled());
    await expect(args.onOpenChange).not.toHaveBeenCalled();

    releaseDelete();

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};
