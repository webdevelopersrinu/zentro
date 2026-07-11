import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RoomListItem } from "../../../src/components/chat/RoomListItem.jsx";
import { ROOM_VISIBILITY } from "../../../src/config/index.js";

const room = (over = {}) => ({
  id: "r1",
  name: "general",
  visibility: ROOM_VISIBILITY.PUBLIC,
  isMember: true,
  isCreator: false,
  hasRequested: false,
  memberCount: 3,
  requestCount: 0,
  ...over,
});

const renderItem = (props = {}) =>
  render(
    <ul>
      <RoomListItem
        room={room()}
        active={false}
        unread={false}
        joining={false}
        onSelect={vi.fn()}
        onJoin={vi.fn()}
        {...props}
      />
    </ul>
  );

describe("RoomListItem — a room I'm in", () => {
  it("selects the room when clicked", async () => {
    const onSelect = vi.fn();
    renderItem({ onSelect });

    await userEvent.click(screen.getByRole("button", { name: /general/ }));

    expect(onSelect).toHaveBeenCalledWith("r1");
  });

  it("marks the open room as current for assistive tech", () => {
    renderItem({ active: true });
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });

  it("shows an unread dot, announced not colour-only", () => {
    renderItem({ unread: true });
    expect(screen.getByLabelText("Unread messages")).toBeInTheDocument();
  });

  it("shows the pending-request count to an admin instead of the unread dot", () => {
    renderItem({ room: room({ isAdmin: true, requestCount: 2 }), unread: true });

    expect(screen.getByLabelText("2 pending requests")).toHaveTextContent("2");
    expect(screen.queryByLabelText("Unread messages")).not.toBeInTheDocument();
  });

  // Approving is an admin's job, so an ordinary member gets the dot, not the count.
  it("shows an ordinary member the unread dot, never the request count", () => {
    renderItem({ room: room({ isAdmin: false, requestCount: 2 }), unread: true });

    expect(screen.getByLabelText("Unread messages")).toBeInTheDocument();
    expect(screen.queryByLabelText("2 pending requests")).not.toBeInTheDocument();
  });
});

describe("RoomListItem — a room I'm NOT in", () => {
  it("offers Join for a public room", async () => {
    const onJoin = vi.fn();
    renderItem({ room: room({ isMember: false }), onJoin });

    await userEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(onJoin).toHaveBeenCalled();
  });

  it("offers Request for a private room, never Join", () => {
    renderItem({
      room: room({ isMember: false, visibility: ROOM_VISIBILITY.PRIVATE }),
    });

    expect(screen.getByRole("button", { name: "Request" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
  });

  it("disables the button once a request is pending", () => {
    renderItem({
      room: room({ isMember: false, visibility: ROOM_VISIBILITY.PRIVATE, hasRequested: true }),
    });

    const button = screen.getByRole("button", { name: /Requested/ });
    expect(button).toBeDisabled();
  });

  it("shows a loading state while joining", () => {
    renderItem({ room: room({ isMember: false }), joining: true });
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("is not selectable — clicking the name does nothing", () => {
    const onSelect = vi.fn();
    renderItem({ room: room({ isMember: false }), onSelect });

    expect(screen.queryByRole("button", { name: /general/ })).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
