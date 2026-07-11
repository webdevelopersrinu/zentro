import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import Chat from "../../src/pages/Chat.jsx";
import { AuthProvider } from "../../src/context/AuthContext.jsx";
import { ToastProvider } from "../../src/context/ToastContext.jsx";
import { ThemeProvider } from "../../src/context/ThemeContext.jsx";
import { server } from "../msw/server.js";
import { API_BASE } from "../../src/config/index.js";

// The socket is not under test here; the drawers' keyboard behaviour is.
vi.mock("../../src/context/SocketContext.jsx", () => ({
  useSocket: () => ({ isReady: true, socket: null }),
}));
vi.mock("../../src/hooks/useSocketEvent.js", () => ({
  useSocketEvent: vi.fn(),
  useSocketEmit: () => vi.fn(),
}));
vi.mock("../../src/hooks/useRoomSubscriptions.js", () => ({ useRoomSubscriptions: vi.fn() }));

const url = (path) => `${API_BASE}${path}`;

const ROOM = {
  id: "r1",
  name: "lobby",
  visibility: "public",
  isMember: true,
  isAdmin: false,
  isCreator: false,
  memberCount: 2,
  requestCount: 0,
  unread: false,
};

/**
 * jsdom answers every media query with `matches: false`, which is the desktop
 * tier — exactly the tier where the bug does not exist. Phone width is the case
 * that matters, so it has to be stated.
 */
const atPhoneWidth = () => {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes("max-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

const renderChat = async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ThemeProvider>
          <AuthProvider>
            <Chat />
          </AuthProvider>
        </ThemeProvider>
      </ToastProvider>
    </QueryClientProvider>
  );

  // With no room open the sidebar is deliberately the only thing on screen, so
  // every drawer assertion below starts from a room actually being open.
  await userEvent.click(await screen.findByRole("button", { name: /lobby/ }));
  await showRooms();
  return container;
};

/**
 * jsdom applies stylesheets but never evaluates media queries, so the phone-only
 * hamburger computes to `display: none` here and a role query filters it out.
 * The width under test is the one matchMedia reports; ByLabelText sidesteps a
 * limitation of the environment, not of the markup.
 */
const showRooms = () => screen.findByLabelText("Show rooms");

beforeEach(() => {
  atPhoneWidth();
  server.use(
    http.get(url("/rooms"), () => HttpResponse.json({ rooms: [ROOM] })),
    http.get(url("/rooms/discover"), () => HttpResponse.json({ rooms: [] })),
    http.get(url("/rooms/r1/messages"), () =>
      HttpResponse.json({ messages: [], hasMore: false })
    ),
    http.get(url("/rooms/r1/receipts"), () => HttpResponse.json({ receipts: [] })),
    http.get(url("/rooms/r1/members"), () => HttpResponse.json({ members: [] })),
    http.post(url("/rooms/r1/read"), () => new HttpResponse(null, { status: 204 }))
  );
});

describe("Chat drawers — the closed sidebar is out of the way", () => {
  it("is inert at phone width, so the first Tab cannot land in it", async () => {
    const container = await renderChat();

    // Everything the off-canvas drawer used to offer a keyboard user for free.
    expect(screen.getByRole("button", { name: "Create room" })).toBeInTheDocument();
    expect(container.querySelector(".sidebar")).toHaveAttribute("inert");
  });

  it("drops inert once it is opened, and Escape closes it again", async () => {
    const container = await renderChat();

    await userEvent.click(await showRooms());
    await waitFor(() =>
      expect(container.querySelector(".sidebar")).not.toHaveAttribute("inert")
    );

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(container.querySelector(".sidebar")).toHaveAttribute("inert"));
  });

  it("keeps the members drawer inert until it is asked for", async () => {
    const container = await renderChat();

    expect(container.querySelector(".members")).toHaveAttribute("inert");

    await userEvent.click(await screen.findByLabelText("Show members"));
    await waitFor(() =>
      expect(container.querySelector(".members")).not.toHaveAttribute("inert")
    );
  });
});