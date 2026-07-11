import {
  toUserDTO,
  toMessageDTO,
  toRoomDTO,
  toMemberDTO,
} from "../../../src/utils/serializers.js";

const VIEWER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";

const user = (over = {}) => ({
  _id: VIEWER,
  username: "alice",
  name: "Alice",
  avatarUrl: "http://x/a.png",
  email: "alice@secret.test",
  providerId: "google-123",
  ...over,
});

const room = (over = {}) => ({
  _id: "room-1",
  name: "lobby",
  visibility: "public",
  creator: VIEWER,
  members: [VIEWER],
  joinRequests: [],
  ...over,
});

describe("toUserDTO", () => {
  it("exposes only public fields", () => {
    expect(toUserDTO(user())).toEqual({
      id: VIEWER,
      username: "alice",
      name: "Alice",
      avatarUrl: "http://x/a.png",
    });
  });

  it("falls back to username when name is absent", () => {
    expect(toUserDTO(user({ name: undefined })).name).toBe("alice");
  });

  it("returns an empty string, not undefined, for a missing avatar", () => {
    expect(toUserDTO(user({ avatarUrl: null })).avatarUrl).toBe("");
  });
});

describe("toMessageDTO", () => {
  it("flattens ids to strings", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const dto = toMessageDTO({
      _id: "msg-1",
      room: { _id: "room-1" },
      username: "alice",
      text: "hi",
      createdAt,
    });

    expect(dto).toEqual({
      id: "msg-1",
      roomId: "room-1",
      username: "alice",
      text: "hi",
      createdAt,
      editedAt: null,
      deleted: false,
      reactions: [],
      parentId: null,
      replyCount: 0,
    });
  });

  it("reports a reply's parent, so the client keeps it out of the main list", () => {
    const dto = toMessageDTO({ _id: "m", room: "r", parent: { _id: "p1" }, replyCount: 0 });

    expect(dto).toMatchObject({ parentId: "p1" });
  });

  it("sends who reacted, not whether the viewer did — one broadcast, many viewers", () => {
    const dto = toMessageDTO({
      _id: "m",
      room: "r",
      reactions: [{ emoji: "👍", users: [{ _id: "u1" }, "u2"] }],
    });

    expect(dto.reactions).toEqual([{ emoji: "👍", users: ["u1", "u2"] }]);
  });

  it("reports an edit, and a deletion, as flags the client can render", () => {
    const editedAt = new Date("2026-01-01T00:05:00Z");
    const dto = toMessageDTO({ _id: "m", room: "r", text: "", editedAt, deletedAt: new Date() });

    expect(dto).toMatchObject({ editedAt, deleted: true });
  });

  it("never leaks the sender's user id", () => {
    const dto = toMessageDTO({
      _id: "m",
      room: "r",
      sender: "secret-user-id",
      username: "alice",
      text: "hi",
      createdAt: new Date(),
    });

    expect(dto).not.toHaveProperty("sender");
  });
});

describe("toRoomDTO", () => {
  it("marks the creator", () => {
    expect(toRoomDTO(room(), VIEWER)).toMatchObject({
      isCreator: true,
      isMember: true,
      hasRequested: false,
      memberCount: 1,
      requestCount: 0,
    });
  });

  it("marks a non-member outsider", () => {
    expect(toRoomDTO(room(), OTHER)).toMatchObject({
      isCreator: false,
      isMember: false,
      hasRequested: false,
    });
  });

  it("marks a pending requester", () => {
    const dto = toRoomDTO(room({ joinRequests: [OTHER] }), OTHER);

    expect(dto).toMatchObject({ isMember: false, hasRequested: true, requestCount: 1 });
  });

  it("computes flags per viewer, not per room", () => {
    const r = room({ members: [VIEWER, OTHER] });

    expect(toRoomDTO(r, VIEWER).isCreator).toBe(true);
    expect(toRoomDTO(r, OTHER).isCreator).toBe(false);
    expect(toRoomDTO(r, OTHER).isMember).toBe(true);
  });

  it("tolerates missing joinRequests (legacy documents)", () => {
    const r = room({ joinRequests: undefined });

    expect(toRoomDTO(r, VIEWER)).toMatchObject({ hasRequested: false, requestCount: 0 });
  });

  it("compares ObjectId-like values by string, not identity", () => {
    const objectId = { _id: VIEWER, toString: () => VIEWER };
    const r = room({ creator: objectId, members: [objectId] });

    expect(toRoomDTO(r, VIEWER)).toMatchObject({ isCreator: true, isMember: true });
  });

  it("never leaks the raw member list", () => {
    expect(toRoomDTO(room(), VIEWER)).not.toHaveProperty("members");
  });
});

describe("toMemberDTO", () => {
  it("merges presence and creator flags onto the user DTO", () => {
    const dto = toMemberDTO(user(), { room: room(), online: true });

    expect(dto).toMatchObject({ username: "alice", online: true, isCreator: true });
    expect(dto).not.toHaveProperty("email");
  });

  it("marks a non-creator member", () => {
    const bob = user({ _id: OTHER, username: "bob" });
    const dto = toMemberDTO(bob, { room: room(), online: false });

    expect(dto).toMatchObject({ online: false, isCreator: false });
  });
});
