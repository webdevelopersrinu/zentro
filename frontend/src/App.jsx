import { Suspense, lazy, useEffect } from "react";

import { useAuth } from "./context/AuthContext.jsx";
import { SocketProvider } from "./context/SocketContext.jsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.jsx";
import Login from "./pages/Login.jsx";
import AuthCallback from "./pages/AuthCallback.jsx";

// Code-split: the login screen paints without downloading the chat bundle.
const Chat = lazy(() => import("./pages/Chat.jsx"));

/** The OAuth callback lands on /auth/success; there is nothing to read from it. */
function useCleanCallbackUrl(isAuthenticated) {
  useEffect(() => {
    if (isAuthenticated && window.location.pathname === "/auth/success") {
      window.history.replaceState({}, "", "/");
    }
  }, [isAuthenticated]);
}

export default function App() {
  const { isLoading, isAuthenticated } = useAuth();

  useCleanCallbackUrl(isAuthenticated);

  if (isLoading) return <AuthCallback />;
  if (!isAuthenticated) return <Login />;

  // Mounted only once authenticated: the socket needs an access token, and
  // keeping it below AuthProvider means signing out tears the connection down.
  return (
    <SocketProvider>
      <Suspense fallback={<AuthCallback message="Loading your rooms…" />}>
        <ErrorBoundary>
          <Chat />
        </ErrorBoundary>
      </Suspense>
    </SocketProvider>
  );
}
