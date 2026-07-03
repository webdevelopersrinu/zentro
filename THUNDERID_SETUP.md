# 🔐 ThunderID — Social Login Setup (Google + GitHub)

Self-hosted social sign-in for Zentro. The frontend shows **Continue with Google
/ GitHub** buttons → the backend runs the OAuth handshake → issues your own app
**JWT** → the chat works exactly as before.

## How the flow works

```
Frontend  ──click "Continue with Google"──▶  GET /api/auth/google
                                                    │  (Passport → Google)
                                             user approves on Google
                                                    │
                                       GET /api/auth/callback/google
                                                    │  find-or-create User in Mongo
                                                    │  sign OUR JWT
                                                    ▼
                     redirect ▶ CLIENT_URL/auth/success?token=<JWT>
                                                    │  frontend stores token
                                                    ▼  chat loads (name + avatar)
```

The JWT already secures the HTTP API (`middleware/auth.js`) and Socket.IO
(`socket/index.js`) — nothing there changed.

---

## 1. Google credentials

1. Go to <https://console.cloud.google.com> → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID → Web application**.
3. **Authorized JavaScript origins:**
   - `http://localhost:5173` (dev)
   - `https://zentro.srinudesetti.in` (prod)
4. **Authorized redirect URIs:**
   - `http://localhost:4000/api/auth/callback/google` (dev)
   - `https://zentro.srinudesetti.in/api/auth/callback/google` (prod)
5. Copy the **Client ID** and **Client secret** into the backend `.env`.

> If your app is in "Testing" mode, add your Google account under **OAuth consent
> screen → Test users**, or publish the app.

## 2. GitHub credentials

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. **Homepage URL:** `https://zentro.srinudesetti.in` (or `http://localhost:5173` for dev).
3. **Authorization callback URL:**
   - `http://localhost:4000/api/auth/callback/github` (dev)
   - `https://zentro.srinudesetti.in/api/auth/callback/github` (prod)
   - (Create a second OAuth App if you want separate dev/prod credentials.)
4. Copy **Client ID** + generate a **Client secret** into the backend `.env`.

## 3. Backend `.env`

Copy `backend/.env.example` → `backend/.env` and fill in:

```ini
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/chatapp
VALKEY_URL=redis://localhost:6379
JWT_SECRET=<long random string>
SESSION_SECRET=<another long random string>

SERVER_URL=http://localhost:4000          # prod: https://zentro.srinudesetti.in
CLIENT_URL=http://localhost:5173          # prod: https://zentro.srinudesetti.in
CLIENT_ORIGIN=http://localhost:5173       # prod: https://zentro.srinudesetti.in

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

## 4. Frontend `.env`

Copy `frontend/.env.example` → `frontend/.env`:

```ini
# dev (backend on :4000)
VITE_API_URL=http://localhost:4000/api
# prod (same domain): VITE_API_URL=/api
```

## 5. Run

```bash
# backend
cd backend && npm install && npm start
# frontend
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>, click **Continue with Google/GitHub**, approve →
you land back logged in.

---

## Production notes (your EC2 + ALB)

- **HTTPS is required** — Google/GitHub reject plain `http://` callbacks on a
  public domain. Terminate TLS at the ALB (ACM cert) or Nginx (Let's Encrypt).
- Route at the ALB / Nginx:
  - `…/api/*`       → backend (Express :4000)
  - `/socket.io`    → backend (WebSocket, **sticky sessions ON**)
  - everything else → frontend (built `dist/`, with SPA fallback to `index.html`)
- **Sticky sessions** (already on for WebSockets) also keep the short OAuth
  round-trip on one EC2, so the in-memory session store is fine — no extra
  session store needed.
- In prod set `NODE_ENV=production` (enables the secure, HTTPS-only session
  cookie) and point `SERVER_URL` / `CLIENT_URL` / `CLIENT_ORIGIN` at
  `https://zentro.srinudesetti.in`.

## What changed in the code

| Area | File | Change |
|------|------|--------|
| Model | `backend/src/models/User.js` | `provider`, `providerId`, `name`, `email`, `avatarUrl`; password optional |
| Strategies | `backend/src/config/passport.js` | **new** — Google + GitHub + find-or-create |
| Routes | `backend/src/routes/auth.routes.js` | OAuth routes + JWT callback redirect + `/me` |
| Token | `backend/src/utils/token.js` | JWT now carries `name` + `avatarUrl` |
| Server | `backend/src/server.js` | session + `passport.initialize/session`, `trust proxy` |
| Search | `backend/src/routes/user.routes.js` | returns `name` + `avatarUrl` |
| Frontend | `frontend/src/utils/auth.js` | **new** — token store, JWT decode, login URLs |
| Frontend | `frontend/src/pages/Login.jsx` | social buttons instead of username/password |
| Frontend | `frontend/src/App.jsx` | captures token, reads user from JWT, bridges to chat |

> **Instagram / Facebook:** intentionally not included. Instagram's basic login
> API was shut down in 2024; Facebook needs app review for email. Add more
> Passport strategies later the same way if you need them.
