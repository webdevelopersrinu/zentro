import React, { useEffect } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useToast } from '../components/Toast';
import { loginUrls } from '../utils/auth';

// GitHub mark (inline SVG so it needs no extra asset / icon export).
function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.31-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58C20.56 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

// Google "G" mark (inline SVG so it needs no extra asset).
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function Login() {
  const { addToast } = useToast();

  // If the OAuth flow failed, the backend sends us back with ?error=auth_failed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'auth_failed') {
      addToast('Sign in failed. Please try again.', 'error');
      window.history.replaceState({}, document.title, '/');
    }
  }, [addToast]);

  // Full-page redirect to the backend, which kicks off the provider login.
  const signInWith = (url) => {
    window.location.href = url;
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo-section">
          <div className="login-logo-icon-wrapper">
            <MessagesSquare className="login-logo-icon" size={40} />
          </div>
          <h1 className="login-logo-title">Zentro</h1>
          <p className="login-logo-subtitle">Talk in real time</p>
        </div>

        <div className="login-form">
          <button
            className="social-btn google-btn focus-ring"
            onClick={() => signInWith(loginUrls.google)}
          >
            <GoogleIcon />
            <span>Continue with Google</span>
          </button>

          <button
            className="social-btn github-btn focus-ring"
            onClick={() => signInWith(loginUrls.github)}
          >
            <GithubIcon />
            <span>Continue with GitHub</span>
          </button>
        </div>

        <p className="login-terms">
          By continuing you agree to chat responsibly. We only use your name and
          profile picture from the provider.
        </p>
      </div>

      <style>{`
        .login-page {
          width: 100vw;
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--color-bg);
          position: fixed;
          left: 0;
          top: 0;
          z-index: 1000;
        }

        .login-card {
          width: 380px;
          background-color: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-card);
          padding: 40px 32px;
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
          display: flex;
          flex-direction: column;
          gap: 28px;
        }

        .login-logo-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .login-logo-icon-wrapper {
          background-color: rgba(108, 92, 231, 0.1);
          color: var(--color-primary);
          padding: 12px;
          border-radius: 50%;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .login-logo-title {
          font-family: var(--font-logo);
          font-size: 26px;
          font-weight: 700;
          color: var(--color-text-primary);
        }

        .login-logo-subtitle {
          font-size: 14px;
          color: var(--color-text-muted);
          margin-top: 4px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .social-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          padding: 13px;
          border-radius: var(--radius-input);
          font-weight: 600;
          font-size: 15px;
          cursor: pointer;
          border: 1px solid var(--color-border);
          transition: background-color var(--transition-fast), transform var(--transition-fast);
        }

        .social-btn:active {
          transform: scale(0.99);
        }

        .google-btn {
          background-color: #ffffff;
          color: #1f1f1f;
        }

        .google-btn:hover {
          background-color: #f2f2f2;
        }

        .github-btn {
          background-color: #24292e;
          color: #ffffff;
          border-color: #24292e;
        }

        .github-btn:hover {
          background-color: #2f363d;
        }

        .login-terms {
          font-size: 12px;
          color: var(--color-text-muted);
          text-align: center;
          line-height: 1.5;
          margin-top: -6px;
        }
      `}</style>
    </div>
  );
}
