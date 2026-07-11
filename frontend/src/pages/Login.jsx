import { useEffect } from "react";
import { Globe, Lock, Zap } from "lucide-react";

import { Button } from "../components/ui/Button.jsx";
import { Logo } from "../components/ui/Logo.jsx";
import { GoogleIcon, GithubIcon } from "../components/ui/BrandIcons.jsx";
import { EmailLogin } from "../components/auth/EmailLogin.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import styles from "./Login.module.css";

const FEATURES = [
  { icon: Globe, title: "Public rooms", body: "Browse and join instantly." },
  { icon: Lock, title: "Private rooms", body: "You approve who gets in." },
  { icon: Zap, title: "Real time", body: "Messages land the moment they're sent." },
];

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();

  // The OAuth callback bounces here with ?error=auth_failed when it goes wrong.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") !== "auth_failed") return;

    toast("Sign in failed. Please try again.", { variant: "error" });
    window.history.replaceState({}, "", "/");
  }, [toast]);

  return (
    <main className={styles.login}>
      <section className={styles.card}>
        <header className={styles.header}>
          <span className={styles.mark}>
            <Logo size={30} />
          </span>
          <h1 className={styles.title}>Zentro</h1>
          <p className={styles.tagline}>Talk in real time.</p>
        </header>

        <div className={styles.actions}>
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            startIcon={<GoogleIcon />}
            onClick={() => login("google")}
          >
            Continue with Google
          </Button>
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            startIcon={<GithubIcon />}
            onClick={() => login("github")}
          >
            Continue with GitHub
          </Button>
        </div>

        <div className={styles.divider}>
          <span>or</span>
        </div>

        <EmailLogin />

        <ul className={styles.features}>
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className={styles.feature}>
              <Icon size={16} aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <span>{body}</span>
              </div>
            </li>
          ))}
        </ul>

        <p className={styles.legal}>
          No passwords. We only read your name and profile picture.
        </p>
      </section>
    </main>
  );
}
