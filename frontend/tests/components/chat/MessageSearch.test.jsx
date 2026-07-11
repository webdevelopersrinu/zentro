import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { MessageSearch } from "../../../src/components/chat/MessageSearch.jsx";
import { SearchHighlight } from "../../../src/components/chat/SearchHighlight.jsx";
import { server } from "../../msw/server.js";
import { API_BASE } from "../../../src/config/index.js";

const ROOM = { id: "r1", name: "lobby" };

const message = (id, text) => ({
  id,
  roomId: ROOM.id,
  username: "alice",
  text,
  createdAt: "2026-07-10T12:00:00.000Z",
  editedAt: null,
  deleted: false,
  reactions: [],
});

const mockSearch = (handler) =>
  server.use(http.get(`${API_BASE}/rooms/r1/messages/search`, handler));

const renderSearch = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MessageSearch room={ROOM} />
    </QueryClientProvider>
  );
};

const openSearch = async () => {
  renderSearch();
  await userEvent.click(screen.getByRole("button", { name: "Search #lobby" }));
  return screen.getByLabelText("Search messages");
};

describe("SearchHighlight", () => {
  const highlighted = () => screen.getAllByRole("mark").map((el) => el.textContent);

  it("marks the matching substring", () => {
    render(<p><SearchHighlight text="standup is at ten" query="standup" /></p>);

    expect(highlighted()).toEqual(["standup"]);
  });

  it("marks every occurrence, not just the first", () => {
    render(<p><SearchHighlight text="deploy, then deploy again" query="deploy" /></p>);

    expect(highlighted()).toHaveLength(2);
  });

  it("matches case-insensitively but shows the original casing", () => {
    render(<p><SearchHighlight text="Standup at ten" query="standup" /></p>);

    expect(highlighted()).toEqual(["Standup"]);
  });

  it("keeps the surrounding text intact", () => {
    const { container } = render(<p><SearchHighlight text="cost is $5" query="cost" /></p>);

    expect(container.textContent).toBe("cost is $5");
  });

  it("treats a regex metacharacter as a literal, and finds it", () => {
    render(<p><SearchHighlight text="cost is $5.00 today" query="$5.00" /></p>);

    expect(highlighted()).toEqual(["$5.00"]);
  });

  it("a wildcard query matches nothing, rather than everything", () => {
    const { container } = render(<p><SearchHighlight text="hello" query=".*" /></p>);

    expect(screen.queryByRole("mark")).not.toBeInTheDocument();
    expect(container.textContent).toBe("hello");
  });

  it("renders plain text when there is no query", () => {
    const { container } = render(<p><SearchHighlight text="hello" query="" /></p>);

    expect(container.textContent).toBe("hello");
  });
});

describe("MessageSearch", () => {
  it("asks for at least two characters before searching", async () => {
    const search = vi.fn(() => HttpResponse.json({ messages: [] }));
    mockSearch(search);
    const input = await openSearch();

    await userEvent.type(input, "a");

    expect(screen.getByText(/at least 2 characters/)).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it("shows matching messages with the term highlighted", async () => {
    mockSearch(() => HttpResponse.json({ messages: [message("m1", "standup is at ten")] }));
    const input = await openSearch();

    await userEvent.type(input, "standup");

    // Must outlast the 300ms debounce plus the request, on a loaded machine.
    const result = await screen.findByText("is at ten", { exact: false }, { timeout: 3000 });
    expect(result).toBeInTheDocument();
    expect(screen.getByRole("mark")).toHaveTextContent("standup");
  });

  it("sends the term to the server rather than filtering locally", async () => {
    const seen = [];
    mockSearch(({ request }) => {
      seen.push(new URL(request.url).searchParams.get("q"));
      return HttpResponse.json({ messages: [] });
    });
    const input = await openSearch();

    await userEvent.type(input, "standup");

    await waitFor(() => expect(seen).toContain("standup"));
  });

  it("debounces, so typing a word is one request and not seven", async () => {
    let calls = 0;
    mockSearch(() => {
      calls += 1;
      return HttpResponse.json({ messages: [] });
    });
    const input = await openSearch();

    await userEvent.type(input, "standup");
    await waitFor(() => expect(calls).toBeGreaterThan(0));

    expect(calls).toBeLessThan(3);
  });

  it("says so when nothing matches", async () => {
    mockSearch(() => HttpResponse.json({ messages: [] }));
    const input = await openSearch();

    await userEvent.type(input, "kubernetes");

    expect(await screen.findByText("No matches")).toBeInTheDocument();
  });

  it("forgets the term when closed, so reopening starts clean", async () => {
    mockSearch(() => HttpResponse.json({ messages: [] }));
    const input = await openSearch();
    await userEvent.type(input, "standup");

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Search #lobby" }));

    expect(screen.getByLabelText("Search messages")).toHaveValue("");
  });
});
