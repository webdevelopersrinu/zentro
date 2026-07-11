import { connectTestDB, resetTestDB, disconnectTestDB } from "../helpers/setup.js";
import { createUser, createRoom } from "../helpers/factories.js";
import { ROOM_VISIBILITY } from "../../src/constants/index.js";

describe("Multiple admins", () => {
  let creator;
  let deputy; // a member the creator promotes
  let member; // an ordinary member
  let stranger;
  let room;

  const promote = (actor, target) =>
    actor.client.post(`/api/rooms/${room.id}/admins/${target.user.id}`);

  const demote = (actor, target) =>
    actor.client.delete(`/api/rooms/${room.id}/admins/${target.user.id}`);

  const members = async (who) =>
    (await who.client.get(`/api/rooms/${room.id}/members`)).body.members;

  const myRoom = async (who) =>
    (await who.client.get("/api/rooms")).body.rooms.find((r) => r.id === room.id);

  beforeAll(connectTestDB);
  afterAll(disconnectTestDB);

  beforeEach(async () => {
    await resetTestDB();
    creator = await createUser({ username: "creator" });
    deputy = await createUser({ username: "deputy" });
    member = await createUser({ username: "member" });
    stranger = await createUser({ username: "stranger" });
    room = await createRoom(creator.client, { name: "lobby", visibility: ROOM_VISIBILITY.PRIVATE });

    for (const user of [deputy, member]) {
      await user.client.post(`/api/rooms/${room.id}/join`);
      await creator.client.post(`/api/rooms/${room.id}/requests/${user.user.id}/approve`);
    }
  });

  it("the creator is an admin without being promoted", async () => {
    expect((await myRoom(creator)).isAdmin).toBe(true);
  });

  it("an ordinary member is not an admin", async () => {
    expect((await myRoom(member)).isAdmin).toBe(false);
  });

  it("the creator can promote a member", async () => {
    const res = await promote(creator, deputy);

    expect(res.status).toBe(200);
    expect((await myRoom(deputy)).isAdmin).toBe(true);
  });

  it("the creator can demote an admin", async () => {
    await promote(creator, deputy);

    const res = await demote(creator, deputy);

    expect(res.status).toBe(200);
    expect((await myRoom(deputy)).isAdmin).toBe(false);
  });

  it("says who is an admin in the member list", async () => {
    await promote(creator, deputy);

    const roster = await members(creator);

    expect(roster.find((m) => m.username === "creator")).toMatchObject({
      isCreator: true,
      isAdmin: true,
    });
    expect(roster.find((m) => m.username === "deputy")).toMatchObject({
      isCreator: false,
      isAdmin: true,
    });
    expect(roster.find((m) => m.username === "member")).toMatchObject({ isAdmin: false });
  });

  describe("what an admin may do", () => {
    beforeEach(() => promote(creator, deputy));

    it("approve a join request", async () => {
      await stranger.client.post(`/api/rooms/${room.id}/join`);

      const res = await deputy.client.post(
        `/api/rooms/${room.id}/requests/${stranger.user.id}/approve`
      );

      expect(res.status).toBe(200);
      expect((await myRoom(stranger)).isMember).toBe(true);
    });

    it("reject a join request", async () => {
      await stranger.client.post(`/api/rooms/${room.id}/join`);

      const res = await deputy.client.post(
        `/api/rooms/${room.id}/requests/${stranger.user.id}/reject`
      );

      expect(res.status).toBe(200);
    });

    it("see the pending requests", async () => {
      await stranger.client.post(`/api/rooms/${room.id}/join`);

      const res = await deputy.client.get(`/api/rooms/${room.id}/requests`);

      expect(res.status).toBe(200);
      expect(res.body.requests).toHaveLength(1);
    });

    it("invite someone", async () => {
      const res = await deputy.client.post(`/api/rooms/${room.id}/invite`, {
        username: stranger.user.username,
      });

      expect(res.status).toBe(200);
    });

    it("rename the room", async () => {
      const res = await deputy.client.patch(`/api/rooms/${room.id}`, { name: "renamed" });

      expect(res.status).toBe(200);
    });
  });

  describe("what an admin may NOT do", () => {
    beforeEach(() => promote(creator, deputy));

    it("delete the room — that stays with the creator", async () => {
      const res = await deputy.client.delete(`/api/rooms/${room.id}`);

      expect(res.status).toBe(403);
    });

    it("promote another admin — moderation cannot escape the owner", async () => {
      const res = await promote(deputy, member);

      expect(res.status).toBe(403);
      expect((await myRoom(member)).isAdmin).toBe(false);
    });

    it("demote a fellow admin", async () => {
      const res = await demote(deputy, deputy);

      expect(res.status).toBe(403);
    });

    it("demote the creator", async () => {
      const res = await demote(creator, creator);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/always an admin/);
    });
  });

  describe("what promotion refuses", () => {
    it("promoting someone who is not a member", async () => {
      const res = await promote(creator, stranger);

      expect(res.status).toBe(404);
    });

    it("promoting the same member twice", async () => {
      await promote(creator, deputy);

      const res = await promote(creator, deputy);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Already an admin/);
    });

    it("demoting a member who is not an admin", async () => {
      const res = await demote(creator, member);

      expect(res.status).toBe(400);
    });

    it("promoting via an id that is not a user", async () => {
      const res = await creator.client.post(`/api/rooms/${room.id}/admins/not-an-objectid`);

      expect(res.status).toBe(404);
    });

    it("an ordinary member promoting themselves", async () => {
      const res = await promote(member, member);

      expect(res.status).toBe(403);
    });

    it("a stranger promoting themselves", async () => {
      const res = await promote(stranger, stranger);

      expect(res.status).toBe(403);
    });
  });

  it("loses admin powers on leaving the room", async () => {
    await promote(creator, deputy);

    await deputy.client.post(`/api/rooms/${room.id}/leave`);
    await deputy.client.post(`/api/rooms/${room.id}/join`);
    await creator.client.post(`/api/rooms/${room.id}/requests/${deputy.user.id}/approve`);

    expect((await myRoom(deputy)).isAdmin).toBe(false);
  });

  it("a rejoining ex-admin cannot moderate until promoted again", async () => {
    await promote(creator, deputy);
    await deputy.client.post(`/api/rooms/${room.id}/leave`);
    await deputy.client.post(`/api/rooms/${room.id}/join`);
    await creator.client.post(`/api/rooms/${room.id}/requests/${deputy.user.id}/approve`);

    const res = await deputy.client.patch(`/api/rooms/${room.id}`, { name: "sneaky" });

    expect(res.status).toBe(403);
  });
});
