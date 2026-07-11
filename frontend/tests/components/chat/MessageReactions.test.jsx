import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageReactions } from "../../../src/components/chat/MessageReactions.jsx";
import { ReactionPicker } from "../../../src/components/chat/ReactionPicker.jsx";
import { REACTION_EMOJIS } from "../../../src/config/index.js";

const [THUMBS, HEART] = REACTION_EMOJIS;
const ME = "u1";

const setup = (reactions) => {
  const onToggle = vi.fn();
  render(
    <MessageReactions reactions={reactions} currentUserId={ME} onToggle={onToggle} />
  );
  return { onToggle };
};

const chip = (emoji) => screen.getByRole("button", { name: new RegExp(`^${emoji}`) });

describe("MessageReactions", () => {
  it("renders nothing when nobody has reacted", () => {
    const { container } = render(
      <MessageReactions reactions={[]} currentUserId={ME} onToggle={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows each emoji with how many people used it", () => {
    setup([{ emoji: THUMBS, users: ["u2", "u3"] }]);

    expect(chip(THUMBS)).toHaveTextContent("2");
  });

  it("marks a chip I am part of as pressed", () => {
    setup([{ emoji: THUMBS, users: [ME, "u2"] }]);

    expect(chip(THUMBS)).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves a chip I am not part of unpressed", () => {
    setup([{ emoji: THUMBS, users: ["u2"] }]);

    expect(chip(THUMBS)).toHaveAttribute("aria-pressed", "false");
  });

  it("says what a click will do, rather than relying on colour", () => {
    setup([
      { emoji: THUMBS, users: [ME] },
      { emoji: HEART, users: ["u2"] },
    ]);

    expect(chip(THUMBS)).toHaveAccessibleName(/click to remove yours/);
    expect(chip(HEART)).toHaveAccessibleName(/click to add yours/);
  });

  it("toggles the emoji that was clicked", async () => {
    const { onToggle } = setup([
      { emoji: THUMBS, users: ["u2"] },
      { emoji: HEART, users: [ME] },
    ]);

    await userEvent.click(chip(HEART));

    expect(onToggle).toHaveBeenCalledWith(HEART);
  });

  it("keeps separate chips for separate emojis", () => {
    setup([
      { emoji: THUMBS, users: ["u2"] },
      { emoji: HEART, users: ["u2"] },
    ]);

    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

describe("ReactionPicker", () => {
  const openPicker = async () => {
    const onPick = vi.fn();
    render(<ReactionPicker onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    return onPick;
  };

  it("stays closed until asked", () => {
    render(<ReactionPicker onPick={vi.fn()} />);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on the quick row, plus a way to the full set", async () => {
    await openPicker();

    expect(screen.getAllByRole("menuitem")).toHaveLength(REACTION_EMOJIS.length + 1);
    expect(screen.getByRole("menuitem", { name: "More emoji" })).toBeInTheDocument();
  });

  it("picks an emoji and closes", async () => {
    const onPick = await openPicker();

    await userEvent.click(screen.getByRole("menuitem", { name: `React with ${HEART}` }));

    expect(onPick).toHaveBeenCalledWith(HEART);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape without picking", async () => {
    const onPick = await openPicker();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("closes when clicking away without picking", async () => {
    const onPick = await openPicker();

    await userEvent.click(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  describe("the full set", () => {
    const openFull = async () => {
      const onPick = await openPicker();
      await userEvent.click(screen.getByRole("menuitem", { name: "More emoji" }));
      return onPick;
    };

    it("offers emoji far beyond the quick row", async () => {
      await openFull();

      expect(screen.getByRole("dialog", { name: "Emoji picker" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "React with 🍕" })).toBeInTheDocument();
    });

    it("filters by keyword", async () => {
      await openFull();

      await userEvent.type(screen.getByRole("searchbox", { name: "Search emoji" }), "pizza");

      expect(screen.getByRole("button", { name: "React with 🍕" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "React with 🚀" })).not.toBeInTheDocument();
    });

    it("says so when nothing matches", async () => {
      await openFull();

      await userEvent.type(
        screen.getByRole("searchbox", { name: "Search emoji" }),
        "zzzznothing"
      );

      expect(screen.getByText(/no emoji match/i)).toBeInTheDocument();
    });

    it("picks an emoji from the grid and closes", async () => {
      const onPick = await openFull();

      await userEvent.click(screen.getByRole("button", { name: "React with 🍕" }));

      expect(onPick).toHaveBeenCalledWith("🍕");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("reopens on the quick row, not on a stale search", async () => {
      await openFull();
      await userEvent.keyboard("{Escape}");

      await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));

      expect(screen.getByRole("menu")).toBeInTheDocument();
    });
  });
});
