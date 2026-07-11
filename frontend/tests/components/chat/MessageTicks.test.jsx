import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MessageTicks, readerCount } from "../../../src/components/chat/MessageTicks.jsx";
import { applyReceipt } from "../../../src/hooks/useReceipts.js";

const SENT_AT = "2026-07-10T12:00:00.000Z";
const before = "2026-07-10T11:59:00.000Z";
const after = "2026-07-10T12:01:00.000Z";

const message = (over = {}) => ({ id: "m1", createdAt: SENT_AT, deleted: false, ...over });
const readBy = (...times) => times.map((lastReadAt, i) => ({ userId: `u${i}`, lastReadAt }));

const ticks = () => screen.queryByRole("img");
const single = () => document.querySelector(".lucide-check");
const double = () => document.querySelector(".lucide-check-check");

/** The component takes a reader COUNT; the test still speaks in receipts. */
const setup = ({ receipts = [], recipientCount = 2, message: msg = message(), ...rest } = {}) =>
  render(
    <MessageTicks
      message={msg}
      readers={readerCount(msg, receipts)}
      recipientCount={recipientCount}
      {...rest}
    />
  );

describe("MessageTicks — states", () => {
  it("shows a clock while the message is still in flight", () => {
    setup({ message: message({ status: "sending" }) });

    expect(ticks()).toHaveAccessibleName("Sending");
  });

  it("shows nothing on a failed send — there is nothing to report", () => {
    setup({ message: message({ status: "failed" }) });

    expect(ticks()).not.toBeInTheDocument();
  });

  it("shows nothing on a deleted message — nobody can read it now", () => {
    setup({ message: message({ deleted: true }) });

    expect(ticks()).not.toBeInTheDocument();
  });

  it("shows ONE tick when nobody has read it", () => {
    setup({ receipts: readBy(before, before) });

    expect(single()).toBeInTheDocument();
    expect(double()).not.toBeInTheDocument();
    expect(ticks()).toHaveAccessibleName("Read by 0 of 2");
  });

  it("shows TWO ticks once someone has read it", () => {
    setup({ receipts: readBy(after, before) });

    expect(double()).toBeInTheDocument();
    expect(ticks()).toHaveAccessibleName("Read by 1 of 2");
  });

  it("colours the ticks only once EVERY recipient has read it", () => {
    const { rerender } = setup({ receipts: readBy(after, before) });
    expect(ticks().className).not.toMatch(/readByAll/);

    rerender(
      <MessageTicks
        message={message()}
        recipientCount={2}
        readers={readerCount(message(), readBy(after, after))}
      />
    );

    expect(ticks().className).toMatch(/readByAll/);
    expect(ticks()).toHaveAccessibleName("Read by 2 of 2");
  });
});

describe("MessageTicks — counting readers", () => {
  it("counts a member who read at the exact instant it was sent", () => {
    setup({ receipts: readBy(SENT_AT), recipientCount: 1 });

    expect(ticks()).toHaveAccessibleName("Read by 1 of 1");
  });

  it("does not count a member whose last read predates the message", () => {
    setup({ receipts: readBy(before), recipientCount: 1 });

    expect(ticks()).toHaveAccessibleName("Read by 0 of 1");
  });

  it("a member who has never read the room is simply missing from receipts", () => {
    setup({ receipts: [], recipientCount: 3 });

    expect(ticks()).toHaveAccessibleName("Read by 0 of 3");
  });

  it("never colours the ticks in a room where I am the only member", () => {
    setup({ receipts: [], recipientCount: 0 });

    expect(ticks()).toHaveAccessibleName("Sent");
    expect(ticks().className).not.toMatch(/readByAll/);
  });
});

describe("applyReceipt", () => {
  const page = { receipts: [{ userId: "u1", lastReadAt: SENT_AT }], memberCount: 3 };

  it("moves a member's mark forward", () => {
    const next = applyReceipt(page, { userId: "u1", lastReadAt: after });

    expect(next.receipts).toEqual([{ userId: "u1", lastReadAt: after }]);
  });

  it("never moves a mark backward — events can arrive out of order", () => {
    const next = applyReceipt(page, { userId: "u1", lastReadAt: before });

    expect(next).toBe(page);
  });

  it("adds a member who had never read the room", () => {
    const next = applyReceipt(page, { userId: "u2", lastReadAt: after });

    expect(next.receipts).toHaveLength(2);
    expect(next.receipts).toContainEqual({ userId: "u2", lastReadAt: after });
  });

  it("keeps one row per member", () => {
    const next = applyReceipt(applyReceipt(page, { userId: "u1", lastReadAt: after }), {
      userId: "u1",
      lastReadAt: "2026-07-10T12:02:00.000Z",
    });

    expect(next.receipts.filter((r) => r.userId === "u1")).toHaveLength(1);
  });

  it("leaves memberCount alone", () => {
    expect(applyReceipt(page, { userId: "u2", lastReadAt: after }).memberCount).toBe(3);
  });
});
