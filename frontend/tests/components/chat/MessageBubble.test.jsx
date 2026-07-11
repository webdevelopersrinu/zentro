import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageBubble } from "../../../src/components/chat/MessageBubble.jsx";
import { MESSAGE_EDIT_WINDOW_MS } from "../../../src/config/index.js";

const message = (over = {}) => ({
  id: "m1",
  roomId: "r1",
  username: "alice",
  text: "hello",
  createdAt: new Date().toISOString(),
  editedAt: null,
  deleted: false,
  ...over,
});

const setup = (props = {}) => {
  const onEdit = vi.fn().mockResolvedValue({ ok: true });
  const onDelete = vi.fn();
  const onRetry = vi.fn();

  render(
    <ul>
      <MessageBubble
        message={message()}
        mine
        showAuthor
        onEdit={onEdit}
        onDelete={onDelete}
        onRetry={onRetry}
        {...props}
      />
    </ul>
  );

  return { onEdit, onDelete, onRetry };
};

const editButton = () => screen.queryByRole("button", { name: "Edit message" });
const deleteButton = () => screen.queryByRole("button", { name: "Delete message" });

// Query by role: the edit BUTTON also carries the aria-label "Edit message".
const editorInput = () => screen.queryByRole("textbox", { name: "Edit message" });

describe("MessageBubble — who may act", () => {
  it("offers edit and delete on my own message", () => {
    setup();

    expect(editButton()).toBeInTheDocument();
    expect(deleteButton()).toBeInTheDocument();
  });

  it("offers nothing on someone else's message", () => {
    setup({ mine: false });

    expect(editButton()).not.toBeInTheDocument();
    expect(deleteButton()).not.toBeInTheDocument();
  });

  it("offers nothing while the message is still being sent", () => {
    setup({ message: message({ id: "temp-1", status: "sending" }) });

    expect(editButton()).not.toBeInTheDocument();
    expect(deleteButton()).not.toBeInTheDocument();
  });

  it("offers nothing on a failed message — there is no server id to act on", () => {
    setup({ message: message({ id: "temp-1", status: "failed" }) });

    expect(deleteButton()).not.toBeInTheDocument();
  });
});

describe("MessageBubble — the one-hour edit window", () => {
  const aged = (ms) => message({ createdAt: new Date(Date.now() - ms).toISOString() });

  it("offers edit just inside the window", () => {
    setup({ message: aged(MESSAGE_EDIT_WINDOW_MS - 60_000) });

    expect(editButton()).toBeInTheDocument();
  });

  it("withdraws edit once the window has passed", () => {
    setup({ message: aged(MESSAGE_EDIT_WINDOW_MS + 60_000) });

    expect(editButton()).not.toBeInTheDocument();
  });

  it("still offers delete on an old message — retracting has no deadline", () => {
    setup({ message: aged(MESSAGE_EDIT_WINDOW_MS * 100) });

    expect(deleteButton()).toBeInTheDocument();
  });
});

describe("MessageBubble — editing", () => {
  it("saves on Enter and closes the editor", async () => {
    const { onEdit } = setup();

    await userEvent.click(editButton());
    const input = editorInput();
    await userEvent.clear(input);
    await userEvent.type(input, "corrected{Enter}");

    expect(onEdit).toHaveBeenCalledWith("m1", "corrected");
    // The editor closes only once the ack resolves, not on keypress.
    await waitFor(() => expect(editorInput()).not.toBeInTheDocument());
  });

  it("cancels on Escape without saving", async () => {
    const { onEdit } = setup();

    await userEvent.click(editButton());
    await userEvent.type(editorInput(), "{Escape}");

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("does not send a request when the text is unchanged", async () => {
    const { onEdit } = setup();

    await userEvent.click(editButton());
    await userEvent.type(editorInput(), "{Enter}");

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("does not send an empty edit — that is what delete is for", async () => {
    const { onEdit } = setup();

    await userEvent.click(editButton());
    await userEvent.clear(screen.getByLabelText("Edit message"));
    await userEvent.type(editorInput(), "{Enter}");

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("keeps the editor open and shows why when the server refuses", async () => {
    const onEdit = vi.fn().mockResolvedValue({
      ok: false,
      error: "Messages can only be edited within an hour of sending",
    });
    setup({ onEdit });

    await userEvent.click(editButton());
    const input = editorInput();
    await userEvent.clear(input);
    await userEvent.type(input, "too late{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("within an hour");
    expect(editorInput()).toBeInTheDocument();
  });

  it("marks an edited message as edited", () => {
    setup({ message: message({ editedAt: new Date().toISOString() }) });

    expect(screen.getByText("edited")).toBeInTheDocument();
  });
});

describe("MessageBubble — deleting", () => {
  it("asks the parent to confirm rather than deleting outright", async () => {
    const { onDelete } = setup();

    await userEvent.click(deleteButton());

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("renders a deleted message as a tombstone, with no text and no actions", () => {
    setup({ message: message({ deleted: true, text: "" }) });

    expect(screen.getByText("This message was deleted")).toBeInTheDocument();
    expect(editButton()).not.toBeInTheDocument();
    expect(deleteButton()).not.toBeInTheDocument();
  });

  it("does not call a deleted message 'edited', even though it was changed", () => {
    setup({ message: message({ deleted: true, text: "", editedAt: new Date().toISOString() }) });

    expect(screen.queryByText("edited")).not.toBeInTheDocument();
  });
});
