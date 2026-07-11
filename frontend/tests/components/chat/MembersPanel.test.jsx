import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { MembersPanel } from "../../../src/components/chat/MembersPanel.jsx";
import { AuthProvider } from "../../../src/context/AuthContext.jsx";
import { ToastProvider } from "../../../src/context/ToastContext.jsx";
import { server } from "../../msw/server.js";
import { API_BASE, } from "../../../src/config/index.js";
import { testUser } from "../../msw/handlers.js";

const room = (over = {}) => ({
  id: "r1",
  name: "lobby",
  isCreator: false,
  isAdmin: false,
  ...over,
});

const member = (id, name, over = {}) => ({
  id,
  username: name,
  name,
  avatarUrl: "",
  online: true,
  isCreator: false,
  isAdmin: false,
  ...over,
});

const ROSTER = [
  member(testUser.id, "Alice", { isCreator: true, isAdmin: true }),
  member("u2", "Deputy", { isAdmin: true }),
  member("u3", "Member"),
];

const mockRoster = (members = ROSTER) => {
  server.use(
    http.get(`${API_BASE}/rooms/r1/members`, () => HttpResponse.json({ members })),
    http.get(`${API_BASE}/rooms/r1/requests`, () => HttpResponse.json({ requests: [] }))
  );
};

const renderPanel = async (roomProps, waitForName = "Deputy") => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      {/* The moderation mutations now report their failures as toasts. */}
      <ToastProvider>
        <AuthProvider>
          <MembersPanel room={room(roomProps)} onInvite={vi.fn()} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  await screen.findByText(waitForName);
};

describe("MembersPanel — who is shown as what", () => {
  it("marks the creator with a crown and an admin with a shield", async () => {
    mockRoster();
    await renderPanel();

    expect(screen.getByLabelText("Creator")).toBeInTheDocument();
    expect(screen.getByLabelText("Admin")).toBeInTheDocument();
  });

  it("gives an ordinary member neither", async () => {
    mockRoster([member("u3", "Member")]);
    await renderPanel({}, "Member");

    expect(screen.queryByLabelText("Creator")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Admin")).not.toBeInTheDocument();
  });
});

describe("MembersPanel — granting moderation", () => {
  it("the creator can promote an ordinary member", async () => {
    const promote = vi.fn(() => HttpResponse.json({ room: room() }));
    mockRoster();
    server.use(http.post(`${API_BASE}/rooms/r1/admins/u3`, promote));
    await renderPanel({ isCreator: true, isAdmin: true });

    await userEvent.click(screen.getByRole("button", { name: "Make Member an admin" }));

    await waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
  });

  it("the creator can demote an admin", async () => {
    const demote = vi.fn(() => HttpResponse.json({ room: room() }));
    mockRoster();
    server.use(http.delete(`${API_BASE}/rooms/r1/admins/u2`, demote));
    await renderPanel({ isCreator: true, isAdmin: true });

    await userEvent.click(screen.getByRole("button", { name: "Remove Deputy as admin" }));

    await waitFor(() => expect(demote).toHaveBeenCalledTimes(1));
  });

  it("offers nothing on the creator's own row — they cannot be demoted", async () => {
    mockRoster();
    await renderPanel({ isCreator: true, isAdmin: true });

    expect(screen.queryByRole("button", { name: /Alice/ })).not.toBeInTheDocument();
  });

  it("an ADMIN who is not the creator cannot promote anyone", async () => {
    mockRoster();
    await renderPanel({ isAdmin: true });

    expect(screen.queryByRole("button", { name: /an admin$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /as admin$/ })).not.toBeInTheDocument();
  });

  it("an ordinary member cannot promote anyone", async () => {
    mockRoster();
    await renderPanel({});

    expect(screen.queryByRole("button", { name: /admin/ })).not.toBeInTheDocument();
  });
});

describe("MembersPanel — moderation powers follow isAdmin, not isCreator", () => {
  it("an admin may invite", async () => {
    mockRoster();
    await renderPanel({ isAdmin: true });

    expect(screen.getByRole("button", { name: "Invite people" })).toBeInTheDocument();
  });

  it("an ordinary member may not invite", async () => {
    mockRoster();
    await renderPanel({});

    expect(screen.queryByRole("button", { name: "Invite people" })).not.toBeInTheDocument();
  });

  it("an admin sees pending requests", async () => {
    mockRoster();
    server.use(
      http.get(`${API_BASE}/rooms/r1/requests`, () =>
        HttpResponse.json({ requests: [{ id: "u9", name: "Stranger", username: "stranger", avatarUrl: "" }] })
      )
    );
    await renderPanel({ isAdmin: true });

    expect(await screen.findByRole("button", { name: "Approve Stranger" })).toBeInTheDocument();
  });

  it("an ordinary member never asks for the requests at all", async () => {
    const requests = vi.fn(() => HttpResponse.json({ requests: [] }));
    mockRoster();
    server.use(http.get(`${API_BASE}/rooms/r1/requests`, requests));
    await renderPanel({});

    expect(requests).not.toHaveBeenCalled();
  });
});
