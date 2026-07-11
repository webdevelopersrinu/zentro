import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageList } from "../../../src/components/chat/MessageList.jsx";

const SENT_AT = "2026-07-10T12:00:00.000Z";
const LATER = "2026-07-10T12:05:00.000Z";

const message = (id, over = {}) => ({
  id,
  roomId: "r1",
  username: "alice",
  text: id,
  createdAt: SENT_AT,
  editedAt: null,
  deleted: false,
  reactions: [],
  parentId: null,
  replyCount: 0,
  ...over,
});

const setup = (props = {}) => {
  const handlers = {
    onRetry: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReact: vi.fn(),
    onOpenThread: vi.fn(),
    onLoadOlder: vi.fn(),
  };

  render(
    <MessageList
      roomId="r1"
      messages={[message("m1")]}
      currentUsername="alice"
      currentUserId="u1"
      receipts={[]}
      recipientCount={2}
      {...handlers}
      {...props}
    />
  );

  return handlers;
};

describe("MessageList — wiring the bubbles", () => {
  it("opens a thread when the reply button is used", async () => {
    const { onOpenThread } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Reply in thread" }));

    expect(onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("opens a thread from the reply count", async () => {
    const { onOpenThread } = setup({ messages: [message("m1", { replyCount: 3 })] });

    await userEvent.click(screen.getByRole("button", { name: /3 replies/ }));

    expect(onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("reacts to the message that was clicked", async () => {
    const { onReact } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /React with 👍/ }));

    expect(onReact).toHaveBeenCalledWith("m1", "👍");
  });

  it("asks to delete the message that was clicked", async () => {
    const { onDelete } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Delete message" }));

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });
});

describe("MessageList — read receipts", () => {
  const readers = () => screen.getByRole("img").getAttribute("aria-label");

  it("counts each message's readers from the room's receipts", () => {
    setup({ receipts: [{ userId: "u2", lastReadAt: LATER }], recipientCount: 2 });

    expect(readers()).toBe("Read by 1 of 2");
  });

  it("counts nobody for a message sent after the last read", () => {
    setup({
      messages: [message("m1", { createdAt: LATER })],
      receipts: [{ userId: "u2", lastReadAt: SENT_AT }],
    });

    expect(readers()).toBe("Read by 0 of 2");
  });

  it("gives each message its own count", () => {
    setup({
      messages: [message("old", { createdAt: SENT_AT }), message("new", { createdAt: LATER })],
      receipts: [{ userId: "u2", lastReadAt: "2026-07-10T12:02:00.000Z" }],
      recipientCount: 1,
    });

    const labels = screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(["Read by 1 of 1", "Read by 0 of 1"]);
  });

  it("shows no ticks on someone else's message", () => {
    setup({ currentUsername: "bob" });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("MessageList — states", () => {
  it("says so when a room has no messages", () => {
    setup({ messages: [] });

    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("shows a day divider above the first message", () => {
    // date-relative: the divider label depends on "now", so anchor the fixture to today
    setup({ messages: [message("m1", { createdAt: new Date().toISOString() })] });

    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("announces that older messages are loading", () => {
    setup({ loadingOlder: true });

    expect(screen.getByText("Loading older messages")).toBeInTheDocument();
  });
});
