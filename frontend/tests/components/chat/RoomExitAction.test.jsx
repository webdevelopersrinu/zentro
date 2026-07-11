import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { RoomExitAction } from "../../../src/components/chat/RoomExitAction.jsx";
import { ToastProvider } from "../../../src/context/ToastContext.jsx";
import { server } from "../../msw/server.js";
import { API_BASE } from "../../../src/config/index.js";

const ROOM = {
  id: "r1",
  name: "town-square",
  visibility: "public",
  memberCount: 4,
  isCreator: false,
};

let queryClient;

const renderAction = (overrides = {}) => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RoomExitAction room={{ ...ROOM, ...overrides }} />
      </ToastProvider>
    </QueryClientProvider>
  );
};

const openDialog = async (name) => {
  await userEvent.click(screen.getByRole("button", { name }));
};

describe("RoomExitAction — a member", () => {
  it("offers Leave, never Delete", () => {
    renderAction();

    expect(screen.getByRole("button", { name: "Leave #town-square" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("confirms before leaving — one click does not leave the room", async () => {
    const leave = vi.fn(() => HttpResponse.json({ ok: true }));
    server.use(http.post(`${API_BASE}/rooms/r1/leave`, leave));
    renderAction();

    await openDialog("Leave #town-square");

    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByText("Leave this room?")).toBeInTheDocument();
  });

  it("leaves once confirmed", async () => {
    const leave = vi.fn(() => HttpResponse.json({ ok: true }));
    server.use(http.post(`${API_BASE}/rooms/r1/leave`, leave));
    renderAction();

    await openDialog("Leave #town-square");
    await userEvent.click(screen.getByRole("button", { name: "Leave room" }));

    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
  });

  it("warns that a private room needs a new invite to return", async () => {
    renderAction({ visibility: "private" });

    await openDialog("Leave #town-square");

    expect(screen.getByText(/need a new invite/)).toBeInTheDocument();
  });

  it("does not warn about invites for a public room", async () => {
    renderAction();

    await openDialog("Leave #town-square");

    expect(screen.queryByText(/need a new invite/)).not.toBeInTheDocument();
  });

  it("cancelling leaves the user in the room", async () => {
    const leave = vi.fn(() => HttpResponse.json({ ok: true }));
    server.use(http.post(`${API_BASE}/rooms/r1/leave`, leave));
    renderAction();

    await openDialog("Leave #town-square");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(leave).not.toHaveBeenCalled();
  });

  it("surfaces a server refusal instead of pretending it worked", async () => {
    server.use(
      http.post(`${API_BASE}/rooms/r1/leave`, () =>
        HttpResponse.json({ error: "Not a member of this room" }, { status: 403 })
      )
    );
    renderAction();

    await openDialog("Leave #town-square");
    await userEvent.click(screen.getByRole("button", { name: "Leave room" }));

    expect(await screen.findByText("Not a member of this room")).toBeInTheDocument();
  });
});

describe("RoomExitAction — the creator", () => {
  const creator = { isCreator: true };

  it("offers Delete, never Leave — the server forbids the creator leaving", () => {
    renderAction(creator);

    expect(screen.getByRole("button", { name: "Delete #town-square" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Leave/ })).not.toBeInTheDocument();
  });

  it("spells out the blast radius before deleting", async () => {
    renderAction(creator);

    await openDialog("Delete #town-square");

    expect(screen.getByText(/every message in it will be gone for all 4 members/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
  });

  it("deletes once confirmed", async () => {
    const remove = vi.fn(() => HttpResponse.json({ ok: true, deletedRoomId: "r1" }));
    server.use(http.delete(`${API_BASE}/rooms/r1`, remove));
    renderAction(creator);

    await openDialog("Delete #town-square");
    await userEvent.click(screen.getByRole("button", { name: "Delete room" }));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });
});
