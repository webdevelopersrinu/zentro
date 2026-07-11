import { describe, expect, it, beforeEach } from "vitest";
import { act, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { usePromoteAdmin, useInviteUser, useApproveRequest } from "../../src/hooks/useMembers.js";
import { ToastProvider } from "../../src/context/ToastContext.jsx";
import { server } from "../msw/server.js";
import { API_BASE } from "../../src/config/index.js";

const url = (path) => `${API_BASE}${path}`;

let queryClient;
const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

/**
 * Every one of these used to fail in total silence: the roster simply did not
 * change and the admin walked away believing the action had taken.
 */
describe("useMembers — a refused moderation action says so", () => {
  it("reports a failed promote", async () => {
    server.use(
      http.post(url("/rooms/r1/admins/u3"), () =>
        HttpResponse.json({ error: "Only the creator can grant admin" }, { status: 403 })
      )
    );

    const { result } = renderHook(() => usePromoteAdmin("r1"), { wrapper });
    await act(() => result.current.mutateAsync("u3").catch(() => {}));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the creator can grant admin"
    );
  });

  it("reports a failed invite", async () => {
    server.use(
      http.post(url("/rooms/r1/invite"), () =>
        HttpResponse.json({ error: "That user is already a member" }, { status: 409 })
      )
    );

    const { result } = renderHook(() => useInviteUser("r1"), { wrapper });
    await act(() => result.current.mutateAsync("bob").catch(() => {}));

    expect(await screen.findByRole("alert")).toHaveTextContent("That user is already a member");
  });

  it("reports a failed approval — the row reappearing is not an explanation", async () => {
    server.use(
      http.post(url("/rooms/r1/requests/u9/approve"), () =>
        HttpResponse.json({ error: "That request no longer exists" }, { status: 404 })
      )
    );

    const { result } = renderHook(() => useApproveRequest("r1"), { wrapper });
    await act(() => result.current.mutateAsync("u9").catch(() => {}));

    expect(await screen.findByRole("alert")).toHaveTextContent("That request no longer exists");
  });
});