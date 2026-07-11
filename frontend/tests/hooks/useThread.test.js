import { describe, expect, it } from "vitest";

import { appendReply, patchThread, bumpReplyCount } from "../../src/hooks/useThread.js";

const message = (id, over = {}) => ({
  id,
  roomId: "r1",
  username: "alice",
  text: id,
  parentId: null,
  replyCount: 0,
  ...over,
});

const thread = () => ({
  parent: message("p1", { replyCount: 1 }),
  replies: [message("r1", { parentId: "p1" })],
});

describe("appendReply", () => {
  it("adds a reply to the end of the thread", () => {
    const next = appendReply(thread(), message("r2", { parentId: "p1" }));

    expect(next.replies.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("ignores a reply it already holds — the ack and the broadcast both arrive", () => {
    const current = thread();

    const next = appendReply(current, message("r1", { parentId: "p1" }));

    expect(next).toBe(current);
  });

  it("does nothing when the thread is not open", () => {
    expect(appendReply(undefined, message("r2"))).toBeUndefined();
  });

  it("leaves the parent alone", () => {
    const next = appendReply(thread(), message("r2", { parentId: "p1" }));

    expect(next.parent.id).toBe("p1");
  });
});

describe("patchThread", () => {
  it("patches the parent when the parent changed", () => {
    const edited = message("p1", { text: "edited", editedAt: "2026-07-10T12:00:00Z" });

    const next = patchThread(thread(), edited);

    expect(next.parent.text).toBe("edited");
    expect(next.replies[0].id).toBe("r1");
  });

  it("patches a reply when a reply changed", () => {
    const edited = message("r1", { parentId: "p1", text: "edited" });

    const next = patchThread(thread(), edited);

    expect(next.replies[0].text).toBe("edited");
    expect(next.parent.text).toBe("p1");
  });

  it("ignores a message that belongs to neither", () => {
    const next = patchThread(thread(), message("other", { parentId: "p1" }));

    expect(next.replies.map((r) => r.id)).toEqual(["r1"]);
  });

  it("does nothing when the thread is not open", () => {
    expect(patchThread(null, message("p1"))).toBeNull();
  });
});

describe("bumpReplyCount", () => {
  const page = () => ({ hasMore: false, messages: [message("p1"), message("p2")] });

  it("increments the parent's counter", () => {
    const next = bumpReplyCount(page(), "p1");

    expect(next.messages[0].replyCount).toBe(1);
  });

  it("leaves every other message alone", () => {
    const next = bumpReplyCount(page(), "p1");

    expect(next.messages[1].replyCount).toBe(0);
  });

  it("does nothing when the room's history is not loaded", () => {
    expect(bumpReplyCount(undefined, "p1")).toBeUndefined();
  });

  it("ignores a parent that is not in the loaded page", () => {
    const next = bumpReplyCount(page(), "not-loaded");

    expect(next.messages.every((m) => m.replyCount === 0)).toBe(true);
  });
});
