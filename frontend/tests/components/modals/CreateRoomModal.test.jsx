import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreateRoomModal } from "../../../src/components/modals/CreateRoomModal.jsx";

const setup = (props = {}) => {
  const onCreate = vi.fn();
  const onClose = vi.fn();
  render(<CreateRoomModal open onClose={onClose} onCreate={onCreate} {...props} />);
  return { onCreate, onClose };
};

describe("CreateRoomModal", () => {
  it("defaults to a public room", () => {
    setup();
    expect(screen.getByRole("radio", { name: /Public/ })).toBeChecked();
  });

  it("creates a public room", async () => {
    const { onCreate } = setup();

    await userEvent.type(screen.getByLabelText("Room name"), "study-group");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreate).toHaveBeenCalledWith(
      { name: "study-group", visibility: "public" },
      expect.any(Function)
    );
  });

  it("creates a private room when that option is chosen", async () => {
    const { onCreate } = setup();

    await userEvent.type(screen.getByLabelText("Room name"), "war-room");
    await userEvent.click(screen.getByRole("radio", { name: /Private/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private" }),
      expect.any(Function)
    );
  });

  // Native constraints: the browser enforces these, we just declare them.
  it("relies on native validation for the name", () => {
    setup();
    const input = screen.getByLabelText("Room name");

    expect(input).toBeRequired();
    expect(input).toHaveAttribute("maxLength", "40");
  });

  it("cannot submit an empty name", () => {
    setup();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("trims the name before submitting", async () => {
    const { onCreate } = setup();

    await userEvent.type(screen.getByLabelText("Room name"), "  spaced  ");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "spaced" }),
      expect.any(Function)
    );
  });

  it("counts characters against the limit", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Room name"), "abc");

    expect(screen.getByText("3/40")).toBeInTheDocument();
  });

  it("surfaces a server rejection on the field", () => {
    setup({ error: "That name is already taken" });

    expect(screen.getByRole("alert")).toHaveTextContent("That name is already taken");
    expect(screen.getByLabelText("Room name")).toHaveAttribute("aria-invalid", "true");
  });

  it("closes on Cancel", async () => {
    const { onClose, onCreate } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
