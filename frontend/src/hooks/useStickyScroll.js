import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const NEAR_BOTTOM_PX = 100;

/**
 * Auto-scrolls to the newest message ONLY when the user is already near the
 * bottom. Otherwise it counts what they missed, so we can offer a "↓ N new"
 * pill instead of yanking them away from the message they are reading.
 *
 * The list grows at both ends: new messages arrive at the bottom, older history
 * is prepended at the top. The two are told apart by the id of the last
 * message, so a prepend is never announced as "N new messages".
 */
export function useStickyScroll(dependency, messages) {
  const containerRef = useRef(null);
  const [pinned, setPinned] = useState(true);
  const [missed, setMissed] = useState(0);

  const itemCount = messages.length;
  const lastId = messages.at(-1)?.id;

  const lastCount = useRef(itemCount);
  const lastIdRef = useRef(lastId);
  const anchorHeight = useRef(null);

  const scrollToBottom = useCallback((behavior = "smooth") => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    setMissed(0);
    setPinned(true);
  }, []);

  /**
   * Call with the container's height BEFORE older messages are prepended.
   * `overflow-anchor` is off, so without this the viewport would land on the
   * top of the newly inserted page instead of staying on what is being read.
   */
  const anchorBeforePrepend = useCallback(() => {
    anchorHeight.current = containerRef.current?.scrollHeight ?? null;
  }, []);

  useLayoutEffect(() => {
    const before = anchorHeight.current;
    const node = containerRef.current;
    if (before == null || !node) return;

    anchorHeight.current = null;
    node.scrollTop += node.scrollHeight - before;
  }, [itemCount]);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;

    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const isNearBottom = distance < NEAR_BOTTOM_PX;

    setPinned(isNearBottom);
    if (isNearBottom) setMissed(0);
  }, []);

  // Growth at the bottom: follow it, or count it. A prepend leaves lastId alone.
  useEffect(() => {
    const added = itemCount - lastCount.current;
    const grewAtBottom = lastId !== lastIdRef.current;

    lastCount.current = itemCount;
    lastIdRef.current = lastId;

    if (added <= 0 || !grewAtBottom) return;

    if (pinned) scrollToBottom("auto");
    else setMissed((count) => count + added);
  }, [itemCount, lastId, pinned, scrollToBottom]);

  // Switching rooms always starts at the bottom.
  useEffect(() => {
    setMissed(0);
    setPinned(true);
    scrollToBottom("auto");
  }, [dependency, scrollToBottom]);

  return { containerRef, handleScroll, missed, scrollToBottom, anchorBeforePrepend };
}
