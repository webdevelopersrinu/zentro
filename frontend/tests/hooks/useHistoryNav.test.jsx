import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useCallback, useState } from "react";
import { renderHook, act } from "@testing-library/react";

import { useRoomUrl, useBackToClose, roomFromUrl } from "../../src/hooks/useHistoryNav.js";

const goTo = (url) => window.history.replaceState(null, "", url);
const back = () => act(() => window.dispatchEvent(new PopStateEvent("popstate")));

beforeEach(() => goTo("/"));
afterEach(() => vi.restoreAllMocks());

describe("useRoomUrl — the open room lives in the URL", () => {
  /**
   * In the app, selectRoom really opens the room — so the harness lets it drive
   * activeRoomId too. A bare mock that took the call and changed nothing would
   * make the hook look like it pushes junk entries when it does not.
   */
  const render = ({ ready = true } = {}) => {
    const selectRoom = vi.fn();
    const api = {};

    const result = renderHook(
      ({ ready }) => {
        const [activeRoomId, setActiveRoomId] = useState(null);
        const open = useCallback((id) => {
          selectRoom(id);
          setActiveRoomId(id);
        }, []);

        api.open = open;
        useRoomUrl({ activeRoomId, selectRoom: open, ready });
        return activeRoomId;
      },
      { initialProps: { ready } }
    );

    return { selectRoom, api, ...result };
  };

  const open = (api, id) => act(() => api.open(id));

  it("puts the open room in the URL", () => {
    const { api } = render();

    open(api, "r1");

    expect(roomFromUrl()).toBe("r1");
  });

  it("clears the room from the URL when the room is closed", () => {
    const { api } = render();
    open(api, "r1");

    open(api, null);

    expect(roomFromUrl()).toBeNull();
  });

  it("opens the room a deep link points at", () => {
    goTo("/?room=r7");

    const { selectRoom, result } = render();

    expect(selectRoom).toHaveBeenCalledWith("r7");
    expect(result.current).toBe("r7");
  });

  it("waits for the rooms to load before honouring a deep link", () => {
    goTo("/?room=r7");

    // The chat screen discards a room it cannot find in the list, so hydrating
    // early would throw the deep link away before the list arrives.
    const { selectRoom, rerender } = render({ ready: false });
    expect(selectRoom).not.toHaveBeenCalled();

    rerender({ ready: true });
    expect(selectRoom).toHaveBeenCalledWith("r7");
  });

  it("honours a deep link only once, not on every render", () => {
    goTo("/?room=r7");
    const { selectRoom, rerender } = render();

    rerender({ ready: true });
    rerender({ ready: true });

    expect(selectRoom).toHaveBeenCalledTimes(1);
  });

  it("never pushes an entry when the URL already agrees", () => {
    goTo("/?room=r1");
    const push = vi.spyOn(window.history, "pushState");

    render();

    // Honouring a deep link must not also push. Pushing on every sync would grow
    // the stack without bound and make Back appear to do nothing.
    expect(push).not.toHaveBeenCalled();
  });

  it("reopens the previous room on Back", () => {
    const { selectRoom, api } = render();
    open(api, "r1");

    goTo("/?room=r2");
    back();

    expect(selectRoom).toHaveBeenLastCalledWith("r2");
  });

  it("closes the room when Back lands on a URL with no room", () => {
    const { selectRoom, api } = render();
    open(api, "r1");

    goTo("/");
    back();

    expect(selectRoom).toHaveBeenLastCalledWith(null);
  });
});

describe("useBackToClose — Back closes the drawer, not the app", () => {
  const render = (open = false) => {
    const close = vi.fn();
    const result = renderHook(({ open }) => useBackToClose(open, close), {
      initialProps: { open },
    });
    return { close, ...result };
  };

  it("pushes a history entry when an overlay opens", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { rerender } = render();

    rerender({ open: true });

    expect(push).toHaveBeenCalledWith({ overlay: true }, "");
  });

  it("closes the overlay on Back instead of leaving the app", () => {
    const { close, rerender } = render();
    rerender({ open: true });

    back();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("pops its own entry when the overlay is closed some other way", () => {
    const goBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = render();
    rerender({ open: true });

    rerender({ open: false }); // closed by the X, the scrim, or Escape

    // The entry it pushed is still on the stack; leaving it there would make the
    // user's next Back appear to do nothing at all.
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it("does not double-pop when the close came from Back itself", () => {
    const goBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = render();
    rerender({ open: true });

    // Back already popped our entry, so history.state is no longer ours.
    window.history.replaceState(null, "", window.location.href);
    back();
    rerender({ open: false });

    expect(goBack).not.toHaveBeenCalled();
  });

  it("does nothing at all while no overlay is open", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { close } = render(false);

    back();

    expect(push).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
