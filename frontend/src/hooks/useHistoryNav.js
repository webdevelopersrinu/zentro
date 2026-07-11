import { useEffect, useRef, useState } from "react";

/**
 * Zentro is one screen, so it has no router. But two pieces of its state are
 * things a user expects the platform to remember, and the browser can only
 * remember what is in the history:
 *
 *   - which room is open  → a reload, or a link you paste to someone, lands
 *                           back in that room instead of on an empty screen
 *   - whether an overlay is up → the Android Back gesture closes the drawer,
 *                           instead of quitting the app mid-conversation
 *
 * The whole thing is the History API and two effects. A router would be a
 * dependency and a rewrite to buy exactly this.
 */

const ROOM_PARAM = "room";

/** The room the current URL is pointing at, or null. */
export const roomFromUrl = () =>
  new URLSearchParams(window.location.search).get(ROOM_PARAM) || null;

const urlForRoom = (roomId) =>
  roomId ? `${window.location.pathname}?${ROOM_PARAM}=${roomId}` : window.location.pathname;

/**
 * Keeps `?room=<id>` and the open room in step, in both directions.
 *
 * `ready` matters: the chat screen closes any room it cannot find in your room
 * list, so hydrating a deep link before the rooms have loaded would immediately
 * discard it. We wait, then open it once — and if the id isn't yours, the sync
 * below quietly cleans the bogus param out of the URL.
 */
export function useRoomUrl({ activeRoomId, selectRoom, ready }) {
  const hydrated = useRef(false);

  /**
   * State, not a ref, and deliberately so: it gates the sync effect below until
   * a COMMIT LATER. Both effects run in the same commit, and at that moment the
   * `selectRoom` above has only been scheduled — `activeRoomId` is still null.
   * Syncing then would push the deep link straight back out of the URL, the very
   * link it is in the middle of honouring.
   *
   * By the next commit the room has opened (URL already agrees, nothing to do)
   * or the room was not ours and the chat screen discarded it (so the sync
   * cleans the bogus param out). Both land correctly.
   */
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!ready || hydrated.current) return;
    hydrated.current = true;

    const fromUrl = roomFromUrl();
    if (fromUrl) selectRoom(fromUrl);
    setSynced(true);
  }, [ready, selectRoom]);

  // Idempotent by design: make the URL match the state, and do nothing when it
  // already does — which is exactly the case after a Back, so a popstate never
  // pushes an entry of its own and the stack cannot grow on its own.
  useEffect(() => {
    if (!synced) return;
    if (roomFromUrl() === (activeRoomId ?? null)) return;

    window.history.pushState({ roomId: activeRoomId ?? null }, "", urlForRoom(activeRoomId));
  }, [activeRoomId, synced]);

  useEffect(() => {
    const onPop = () => selectRoom(roomFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [selectRoom]);
}

/**
 * Makes Back close an overlay instead of leaving the app.
 *
 * Opening pushes a throwaway entry; Back pops it and we close. If the user
 * closes the overlay some other way (the X, the scrim, Escape) that entry is
 * still on the stack, so we pop it ourselves — otherwise it would pile up and
 * the next Back would appear to do nothing at all.
 */
export function useBackToClose(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return undefined;

    window.history.pushState({ overlay: true }, "");

    const onPop = () => closeRef.current();
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Ours is still the current entry ⇒ this close did NOT come from Back.
      if (window.history.state?.overlay) window.history.back();
    };
  }, [open]);
}
