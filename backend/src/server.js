import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import session from "express-session";
import { Server } from "socket.io";

import { connectDB } from "./config/db.js";
import { attachValkeyAdapter } from "./config/valkey.js";
import { registerSocketHandlers } from "./socket/index.js";
import passport from "./config/passport.js";

import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import roomRoutes from "./routes/room.routes.js";

const {
  PORT = 4000,
  MONGO_URI,
  VALKEY_URL,
  CLIENT_ORIGIN = "*",
  SESSION_SECRET = "change_this_session_secret",
  NODE_ENV = "development",
} = process.env;

async function start() {
  // 1. Database (shared by all servers)
  await connectDB(MONGO_URI);

  // 2. HTTP + Express API
  const app = express();
  // Behind the ALB / Nginx we sit behind a proxy — trust it so secure cookies
  // and the correct protocol are detected for the OAuth redirect flow.
  app.set("trust proxy", 1);
  app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
  app.use(express.json());

  // Short-lived session used ONLY during the OAuth handshake (Passport stores
  // the CSRF `state` here). Sticky sessions at the ALB keep the round-trip on
  // one server, so the default in-memory store is fine. After login the app
  // uses the JWT, not this session.
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: NODE_ENV === "production", // HTTPS-only cookie in prod
        sameSite: "lax",
        maxAge: 10 * 60 * 1000, // 10 min — only needs to survive the redirect
      },
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  // Health check. Exposed at both paths: "/health" for a direct hit on :4000,
  // and "/api/health" because Nginx/ALB forward the "/api" prefix unchanged.
  const health = (_req, res) => res.json({ ok: true, pid: process.pid });
  app.get("/health", health);
  app.get("/api/health", health);
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/rooms", roomRoutes);

  const server = http.createServer(app);

  // 3. Socket.IO + Valkey adapter (this is what syncs the 2 servers)
  const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });
  await attachValkeyAdapter(io, VALKEY_URL);
  registerSocketHandlers(io);

  // 4. Listen
  server.listen(PORT, () =>
    console.log(`🚀 Server listening on :${PORT} (pid ${process.pid})`)
  );
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
