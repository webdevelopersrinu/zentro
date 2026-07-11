import { useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";

import { Button } from "../ui/Button.jsx";
import { Input } from "../ui/Input.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import * as authService from "../../services/auth.service.js";
import styles from "./EmailLogin.module.css";

const CODE_LENGTH = 6;

/**
 * Passwordless: we email a 6-digit code and swap it for a session. The email
 * field is validated by the browser (`type="email"` + `required`); only the
 * server can say whether a code is right, so that error comes from the server.
 */
export function EmailLogin() {
  const { completeLogin } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requestCode = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await authService.requestEmailCode(email);
      setSent(true);
      toast(`We sent a code to ${email}`);
    } catch (requestError) {
      toast(requestError.message, { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      completeLogin(await authService.verifyEmailCode(email, code));
    } catch (verifyError) {
      setError(verifyError.message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <form className={styles.form} onSubmit={requestCode}>
        <Input
          type="email"
          name="email"
          placeholder="you@example.com"
          aria-label="Email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          startIcon={<Mail size={16} />}
          required
          autoComplete="email"
        />
        <Button type="submit" size="lg" fullWidth loading={busy} disabled={!email}>
          Email me a code
        </Button>
      </form>
    );
  }

  return (
    <form className={styles.form} onSubmit={verify}>
      <Input
        // inputMode brings up the number pad without rejecting a pasted code.
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={CODE_LENGTH}
        placeholder="123456"
        aria-label={`${CODE_LENGTH}-digit code`}
        className={styles.code}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        error={error}
        hint={`Sent to ${email}. It expires in 10 minutes.`}
        required
        autoFocus
      />

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={busy}
        disabled={code.length !== CODE_LENGTH}
      >
        Verify and sign in
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        startIcon={<ArrowLeft size={14} />}
        onClick={() => {
          setSent(false);
          setCode("");
          setError("");
        }}
      >
        Use a different email
      </Button>
    </form>
  );
}
