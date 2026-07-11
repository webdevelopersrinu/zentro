import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { server } from "./msw/server.js";

// Fail loudly on a request no handler covers — an unmocked call is a bug.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());

/**
 * jsdom ships <dialog> without showModal/close. Setting `open` is the part that
 * matters: a closed <dialog> is display:none, so its buttons are absent from
 * the accessibility tree and getByRole cannot find them.
 */
HTMLDialogElement.prototype.showModal = vi.fn(function showModal() {
  this.open = true;
});
HTMLDialogElement.prototype.close = vi.fn(function close() {
  this.open = false;
});

// jsdom has no layout, so it implements no scrolling at all. useStickyScroll
// calls this on every render of a message list.
Element.prototype.scrollTo = vi.fn();

// jsdom implements neither of these, and both are used before first paint.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}
