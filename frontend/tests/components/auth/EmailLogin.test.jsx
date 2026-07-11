import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { EmailLogin } from "../../../src/components/auth/EmailLogin.jsx";
import { AuthProvider } from "../../../src/context/AuthContext.jsx";
import { ToastProvider } from "../../../src/context/ToastContext.jsx";
import { server } from "../../msw/server.js";
import { API_BASE } from "../../../src/config/index.js";
import { getAccessToken } from "../../../src/lib/tokenStore.js";

const url = (path) => `${API_BASE}${path}`;

const renderLogin = () =>
  render(
    <ToastProvider>
      <AuthProvider>
        <EmailLogin />
      </AuthProvider>
    </ToastProvider>
  );

const emailField = () => screen.getByLabelText("Email address");
const codeField = () => screen.getByLabelText("6-digit code");

const askForCode = async () => {
  await userEvent.type(emailField(), "someone@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  await waitFor(() => expect(codeField()).toBeInTheDocument());
};

const okRequest = () => http.post(url("/auth/email/request"), () => HttpResponse.json({ ok: true }));

describe("EmailLogin — step 1, ask for a code", () => {
  it("uses native email validation rather than hand-rolled state", () => {
    renderLogin();
    expect(emailField()).toBeRequired();
    expect(emailField()).toHaveAttribute("type", "email");
  });

  it("cannot submit an empty email", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeDisabled();
  });

  it("moves to the code step once the code is sent", async () => {
    server.use(okRequest());
    renderLogin();

    await askForCode();

    expect(codeField()).toBeInTheDocument();
    expect(screen.getByText(/Sent to someone@example.com/)).toBeInTheDocument();
  });
});

describe("EmailLogin — step 2, verify", () => {
  it("accepts only 6 digits before enabling submit", async () => {
    server.use(okRequest());
    renderLogin();
    await askForCode();

    const submit = screen.getByRole("button", { name: "Verify and sign in" });
    await userEvent.type(codeField(), "12345");
    expect(submit).toBeDisabled();

    await userEvent.type(codeField(), "6");
    expect(submit).toBeEnabled();
  });

  it("strips non-digits as they are typed", async () => {
    server.use(okRequest());
    renderLogin();
    await askForCode();

    await userEvent.type(codeField(), "1a2b3c");
    expect(codeField()).toHaveValue("123");
  });

  it("stores the access token in memory on success", async () => {
    server.use(
      okRequest(),
      http.post(url("/auth/email/verify"), () =>
        HttpResponse.json({ accessToken: "email-token", user: { username: "someone" } })
      )
    );
    renderLogin();
    await askForCode();

    await userEvent.type(codeField(), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));

    await waitFor(() => expect(getAccessToken()).toBe("email-token"));
    expect(JSON.stringify({ ...localStorage })).not.toContain("email-token");
  });

  it("surfaces the server's rejection on the field and clears the code", async () => {
    server.use(
      okRequest(),
      http.post(url("/auth/email/verify"), () =>
        HttpResponse.json({ error: "Invalid or expired code" }, { status: 400 })
      )
    );
    renderLogin();
    await askForCode();

    await userEvent.type(codeField(), "999999");
    await userEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid or expired code")
    );
    expect(codeField()).toHaveValue("");
    expect(codeField()).toHaveAttribute("aria-invalid", "true");
  });

  it("can go back and use a different email", async () => {
    server.use(okRequest());
    renderLogin();
    await askForCode();

    await userEvent.click(screen.getByRole("button", { name: /Use a different email/ }));

    expect(emailField()).toBeInTheDocument();
  });
});
