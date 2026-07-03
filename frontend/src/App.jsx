import React, { useState, useEffect } from 'react';
import { ToastProvider } from './components/Toast';
import Login from './pages/Login';
import Chat from './pages/Chat';
import { mockStore } from './utils/mockStore';
import { captureTokenFromUrl, getUser, logout as authLogout } from './utils/auth';
import './styles/theme.css';

function App() {
  // On first load, grab a token if the backend just redirected us here after
  // a successful Google/GitHub login, then read who we are from the JWT.
  const [user, setUser] = useState(() => {
    captureTokenFromUrl();
    return getUser();
  });

  // Bridge the real identity into the existing chat store so the chat UI (rooms,
  // messages, members) works with the logged-in username.
  useEffect(() => {
    if (user) mockStore.login(user.username);
  }, [user]);

  const handleLogout = () => {
    authLogout();        // clear the JWT (ThunderID)
    mockStore.logout();  // clear the chat-store session
    setUser(null);
  };

  return (
    <ToastProvider>
      {user ? (
        <Chat onLogout={handleLogout} />
      ) : (
        <Login />
      )}
    </ToastProvider>
  );
}

export default App;
