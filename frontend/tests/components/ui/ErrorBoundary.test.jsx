import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { ErrorBoundary } from "../../../src/components/ui/ErrorBoundary.jsx";

const Boom = () => {
  throw new Error("undefined is not an object");
};

// React logs the caught error itself; that noise is not a test failure.
const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => quiet.mockClear());

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>the app</p>
      </ErrorBoundary>
    );

    expect(screen.getByText("the app")).toBeInTheDocument();
  });

  it("catches a throwing child instead of blanking the page", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});