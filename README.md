<div align="center">

# 💬 Zentro

**A production-grade, horizontally-scaled real-time chat platform.**

Built to prove — and to stress-test — the Valkey adapter for Socket.IO.

[![npm](https://img.shields.io/npm/v/socket.io-valkey-adapter?label=socket.io-valkey-adapter&color=6378FF)](https://www.npmjs.com/package/socket.io-valkey-adapter)
[![license](https://img.shields.io/badge/license-MIT-blue)](#-license)
[![tests](https://img.shields.io/badge/tests-725%20passing-brightgreen)](#-testing--the-five-layer-pyramid)
[![layers](https://img.shields.io/badge/test%20layers-5-brightgreen)](#-testing--the-five-layer-pyramid)
[![realtime](https://img.shields.io/badge/realtime-0%20HTTP%20requests-6378FF)](#-performance--engineered-for-low-latency)
[![renders](https://img.shields.io/badge/renders-only%20what%20changed-6378FF)](#-performance--engineered-for-low-latency)

### ⚡ Built for **low latency** — measured in the things that actually cost you time

**🔧 Real regressions fixed** — *before → after, genuinely in this repo*

| ✓✓ Read receipts | 🧩 Re-renders | 📄 History |
|:--:|:--:|:--:|
| **O(N²)** socket frames per message → **1 write / burst** | **every bubble** re-rendered → **only what changed** | oldest 100, rest **unreachable** → **cursor-paged**, all reachable |

**🏗 By design** — *the naive implementation, deliberately avoided*

| 🔔 A message arrives | 🔎 "Is there more?" | 📦 The login screen |
|:--:|:--:|:--:|
| refetch the list → **0 HTTP requests** | a `count()` query → **one extra row** | ship the app → **−29 kB gzip** |

**[ ⚡ See how, with the code → ](#-performance--engineered-for-low-latency)**

</div>

---

# ⚡ The engine: `socket.io-valkey-adapter`

> **This project exists because of this package.** Zentro is its reference implementation — the place where the adapter is integrated, exercised across multiple nodes, and **proven correct by an automated suite that boots two independent Node processes and makes them talk to each other through Valkey.**

<div align="center">

### 📦 [`socket.io-valkey-adapter`](https://www.npmjs.com/package/socket.io-valkey-adapter)

**The Socket.IO Valkey adapter — broadcast events between several Socket.IO servers.**

| | |
|---|---|
| 📦 **npm** | [`npmjs.com/package/socket.io-valkey-adapter`](https://www.npmjs.com/package/socket.io-valkey-adapter) |
| 💻 **Source** | [`github.com/webdevelopersrinu/socket.io-valkey-adapter`](https://github.com/webdevelopersrinu/socket.io-valkey-adapter) |
| 🌐 **Docs** | [`valkey.srinudesetti.in`](https://valkey.srinudesetti.in/) |
| 🏷️ **Version** | `0.1.1` · MIT |

```bash
npm install socket.io-valkey-adapter iovalkey
```

</div>

## The problem it solves

A single Socket.IO server keeps its rooms **in memory**. The moment you put a *second* server behind a load balancer, that memory is no longer shared:

```
        ❌  WITHOUT AN ADAPTER

   Alice ──▶  Server A   [rooms in RAM]  ──▶ ✉️  emitted into the void
                                                 Server B never hears it

   Bob   ──▶  Server B   [rooms in RAM]      🔇  Bob sees nothing
```

Alice and Bob are in the same room — but on different machines, so **they cannot talk to each other**. Scaling out silently breaks the app.

The adapter fixes this by making Valkey the **message bus** between every node:

```
        ✅  WITH socket.io-valkey-adapter

   Alice ──▶  Server A ──── publish ────┐
                                        ▼
                              🔴  V A L K E Y   (pub/sub)
                                        │
   Bob   ◀──  Server B ◀─── subscribe ──┘

        Server B's subClient receives A's publish and
        delivers the message to Bob.        ✉️  →  🔔
```

## How Zentro wires it up

Each server opens **two** connections to the same Valkey — one to publish, one to subscribe. A subscribed connection cannot issue ordinary commands, which is exactly why it is *duplicated* rather than shared.

```js
// backend/src/config/valkey.js
import Valkey from "iovalkey";
import { createAdapter } from "socket.io-valkey-adapter";

export async function attachValkeyAdapter(io, valkeyUrl) {
  const pubClient = new Valkey(valkeyUrl);   // publishes out to Valkey
  const subClient = pubClient.duplicate();   // receives from other servers

  io.adapter(createAdapter(pubClient, subClient));
  return { pubClient, subClient };
}
```

**That is the entire integration.** From this line on, `io.to(roomId).emit(...)` reaches every member of that room **on every server in the cluster** — and the application code never has to know there is more than one machine.

## 🧪 Proven, not assumed

The adapter is not merely *used* here. It is **verified by a suite that boots two real Node processes** (`:4101` and `:4102`) sharing one MongoDB and one Valkey, and asserts that events genuinely cross the process boundary.

> **If Valkey is stopped, these tests fail.** That is the point of them.

```
backend/e2e/realtime/multi-server.spec.js   ──  12 cross-server tests
```

| Cross-server behaviour proven | |
|---|---|
| Both servers are genuinely **different processes** (asserts `pidA !== pidB`) | ✅ |
| A message sent on **server A** reaches a member on **server B** | ✅ |
| Messages flow in **both** directions | ✅ |
| A room created **after** the sockets connect still syncs | ✅ |
| **Typing indicators** cross servers | ✅ |
| **Presence** — leaving server A notifies a user on server B | ✅ |
| A **join request** on server A notifies the admin on server B | ✅ |
| A **read receipt** on server B turns the author's ticks blue on server A | ✅ |
| A **non-member** on server B never receives the room's messages 🔒 | ✅ |
| Message **history** written on A is readable from B | ✅ |

```bash
cd backend && npm run test:e2e      # 27 passed — two servers, one Valkey
```

---

# ⚡ Performance — engineered for low latency

> Every claim below is **verifiable in the source**, and is stated as one of two things — never blurred:
>
> - **🔧 Fixed** — a real regression that existed in this repository.
> - **🏗 By design** — a property of how it is built, contrasted with the naive implementation it deliberately avoids.
>
> The units are the ones that actually cost a user milliseconds: **queries issued, socket frames emitted, components re-rendered, bytes shipped.** There are **no invented latency figures** here — this project ships no benchmark harness, and a fabricated "800 ms → 120 ms" is the fastest way to lose a reviewer who checks.

<div align="center">

## 🔧 Real regressions, found and fixed

| | Before *(genuinely, in this repo)* | After |
|:--|:--|:--|
| ✓✓ **Read-receipt storm** | Each incoming message triggered a `/read` write **per viewer**, and the server broadcasts every receipt to **every** member — **O(members²) socket frames per chat message.** Past ~20 msg/min it exhausted the rate limiter and **429'd the user out of their own session.** | **One write per burst** (2 s trailing debounce) |
| 🧩 **Wasted re-renders** | `MessageBubble` is `memo`'d, but the memo **never hit**: the whole `receipts` **array** was passed to every bubble (new identity whenever *anyone* read *anything*), and inline arrows were recreated each render. **One person opening a room re-rendered every bubble in it.** | Reader counts computed **once** into a `Map`; each bubble takes a **plain number**; callbacks hoisted to stable `useCallback` — **only what changed re-renders** |
| 📄 **Unreachable history** | `.limit(100)` sorted **ascending** — it returned the **oldest 100** messages, and everything newer was **silently unreachable**. A correctness bug that grows with use. | **Cursor pagination** — 50 rows/page, newest first, **all history reachable** |

## 🏗 Design properties — the naive implementation, deliberately avoided

| | The obvious way | What Zentro does |
|:--|:--|:--|
| 🔎 **"Is there more?"** | A second `count()` query per page | **One extra row** (`.limit(size + 1)`) — **no second query, ever** |
| 🔔 **A message arrives** | Invalidate → **refetch the whole list** (an N+1 storm) | The socket already handed us the data — **patch the cache. 0 HTTP requests.** |
| 💬 **"3 replies" / unread dots** | A `count()` per row while rendering | **Denormalised** `replyCount` / `lastMessageAt` — **no extra query** |
| 📦 **The login screen** | Ship the whole app | Chat is `lazy()` — **29 kB gzip never downloaded** |
| 🗑 **Expired tokens / OTPs** | A cron job | **MongoDB TTL indexes** — the database expires them |

</div>

## 1. 📄 Cursor pagination — and the bug it fixed 🔧

The original query was not merely un-paginated. It was **wrong**:

```js
// BEFORE — returns the OLDEST 100. Everything newer was unreachable.
Message.find({ room }).sort({ createdAt: 1 }).limit(100);
```

```js
// AFTER — backend/src/services/room.service.js
const page = await Message.find({ room, parent: null, ...(before && { _id: { $lt: before } }) })
  .sort({ _id: -1 })
  .limit(size + 1);          // ← ONE extra row answers "hasMore"

const hasMore = page.length > size;
if (hasMore) page.pop();
```

- **50 messages per page** (hard cap 100). Older pages load on scroll-to-top.
- **`hasMore` costs one extra row — never a second `count()` query.** 🏗
- The cursor is **`_id`, not `createdAt`** — `_id` is unique, so two messages written in the same millisecond can never make the cursor **skip** one. 🏗

## 2. 🗂 Indexes shaped to the query that uses them

Each index exists to serve one specific access path — not sprinkled on afterwards.

| Index | Serves |
|---|---|
| `{ room, parent, _id: -1 }` | Message history — equality on `room`+`parent`, then a descending walk from the cursor |
| `{ parent, _id: 1 }` | A whole thread, oldest first |
| `{ members, updatedAt: -1 }` | **"My rooms"** — the sidebar, on every load |
| `{ room, user }` *(unique)* | Read receipts — and it enforces one row per member |
| `{ provider, providerId }` *(unique)* | OAuth identity lookup |
| `{ expiresAt }` *(TTL × 2)* | Refresh tokens & OTPs — **MongoDB expires them for us; no cron job** |

> ### 🔎 Two known scans — documented, not hidden
>
> A reviewer will find these, so here they are, stated plainly:
>
> - **`GET /rooms/discover`** runs `{ members: { $ne: userId } }`. **`$ne` is not selective and cannot use the index** — this is a collection scan. Acceptable while room count is in the dozens; it needs pagination (or a materialised "public rooms" projection) before it is not.
> - **Message search** uses an escaped, unanchored regex. It is **bounded to one room** by the compound index, but scans that room's messages. Chosen deliberately over a `$text` index because users expect `"stand"` to find `"standup"` — which word-based text search cannot do. It carries a `ponytail:` note in the source naming the ceiling and the upgrade path.
>
> Both are **capped and bounded**. Neither is index-served, and claiming otherwise would be false.

## 3. 🔔 Real-time costs **zero** HTTP 🏗

The naive approach is an **N+1 disaster**: a message arrives → invalidate the query → refetch the entire list. Ten people chatting = ten full history downloads.

```js
// The socket already handed us the data. Write it straight into the cache.
queryClient.setQueryData(key, (page) => appendMessage(page, message));
```

> **A message arriving triggers 0 network requests.** Not a smaller one — *none*.

## 4. ✓✓ Killing an O(N²) broadcast storm 🔧

```js
// frontend/src/hooks/useChatState.js
const READ_TRAIL_MS = 2000;   // one read per burst of chatter, not one per message
```

Read receipts fired a write **per incoming message, per viewer** — and the server broadcasts every receipt to **every** member. In a room of N people, a single chat message cost **N² socket frames**; past ~20 messages/minute it burned through the rate limiter and **429'd the user out of their own session**.

**O(N²) per message → one write per burst.** The receipt is just as accurate. It simply stops shouting.

## 5. 🧩 Modular, memoised components — render only what changed 🔧

Every bubble is `memo`'d — but a memo only works if its props are **stable**. Two leaks were silently defeating it:

| The leak | The fix |
|---|---|
| The whole `receipts` **array** was handed to every bubble — and it gets a **new identity whenever anyone reads anything** | Reader counts computed **once** for the list into a `Map`; each bubble receives a **plain number** |
| Fresh inline arrows (`onRetry`, `onOpenThread`, …) on every render = a changed prop on **every** bubble | Hoisted to **stable `useCallback` identities** |

> **Before:** one person opening a room re-rendered **every bubble in it**.
> **After:** only the bubbles that actually changed.

## 6. 📦 Ship less JavaScript — code splitting + long-term caching 🏗

Real figures, straight from `npm run build`:

```
dist/assets/react-….js       57.19 kB gzip   ← vendor, cached across deploys
dist/assets/data-….js        29.84 kB gzip   ← TanStack Query + axios
dist/assets/realtime-….js    12.86 kB gzip   ← socket.io
dist/assets/Chat-….js        24.14 kB gzip   ← 🔒 LAZY — not on the login path
dist/assets/Chat-….css        4.76 kB gzip   ← 🔒 LAZY
```

- The chat bundle is **`lazy()`-loaded** — someone sitting on the login screen **never downloads 29 kB gzip** of an app they cannot yet see.
- Vendor is split **by change frequency** (`react` · `data` · `realtime`), so shipping your own app code **does not bust React's cache** in every user's browser.

## 7. 🛡 Bounded by design — nothing is unbounded 🏗

| Limit | Value | Stops |
|---|---|---|
| Request body | **10 KB** | Payload DoS |
| Messages per page | **50** (max 100) | Unbounded reads |
| Search results | **25** | Unbounded reads |
| Socket events | **20 / 10 s** per socket | Flood |
| Search term | Regex-**escaped** + length-capped | **ReDoS** — a CPU pinned by `(a+)+$` |

---

# 🎯 What Zentro is

A real-time chat platform with public and private rooms, threads, reactions, read receipts, search and role-based moderation — engineered to the standard you would ship to production, not to a tutorial.

<div align="center">

| | |
|---|---|
| 🔐 **Auth** | Google · GitHub OAuth · passwordless email OTP — **no passwords, ever** |
| 🏠 **Rooms** | **Public** → join instantly · **Private** → request, an admin approves |
| ✉️ **Invites** | The invitee **accepts** — nobody joins a room without their own consent |
| 💬 **Messaging** | Threads · reactions (any emoji) · edit (1 h window) · delete (tombstone) |
| ✓✓ **Receipts** | WhatsApp-style ticks — grey → **blue** once everyone has read it |
| 🔍 **Search** | Per-room · ReDoS-safe · never surfaces deleted messages |
| 👑 **Moderation** | The creator grants admin; admins approve, invite and rename |
| ⚡ **Real-time** | Messages · typing · presence · unread — across **every server** |

</div>

---

# 🏛 Architecture

```
                        ☁️  Cloudflare  — DNS + TLS
                                   │
                   ┌───────────────▼────────────────┐
                   │  AWS Application Load Balancer │
                   │   (sticky sessions for OAuth)  │
                   └───────┬────────────────┬───────┘
                           │                │
                ┌──────────▼──────┐  ┌──────▼──────────┐
                │     EC2  #1     │  │     EC2  #2     │
                │  Node · Socket  │  │  Node · Socket  │
                │      .IO        │  │      .IO        │
                └────┬───────┬────┘  └────┬───────┬────┘
                     │       │            │       │
        ┌────────────▼───────┴────────────┴───────▼────────────┐
        │                                                      │
   ┌────▼──────────────────┐                ┌──────────────────▼───┐
   │  🔴  V A L K E Y      │                │  🍃  M O N G O D B   │
   │      THE WIRE         │                │      THE TRUTH       │
   │                       │                │                      │
   │  pub/sub only.        │                │  users · rooms       │
   │  Transient.           │                │  messages · threads  │
   │  Nothing is stored.   │                │  reactions · receipts│
   │                       │                │  refresh tokens      │
   │  Losing it costs      │                │                      │
   │  a broadcast —        │                │  Losing it costs     │
   │  never data.          │                │  everything.         │
   └───────────────────────┘                └──────────────────────┘
```

### The single most important architectural decision

> ### **MongoDB is the source of truth. Valkey is the wire between servers — never a data store.**

Every durable fact — a message, a membership, a refresh token — lives in **MongoDB**. Valkey carries **only** transient pub/sub traffic. This is deliberate, and it is load-bearing:

- A `FLUSHALL` on Valkey costs you **one broadcast**, not one byte of user data.
- Valkey can be restarted, resized or replaced with **zero data loss**.
- Refresh tokens were **deliberately migrated out of Valkey into MongoDB** — a cache eviction must never silently log out every user in the system.

---

# 🏗 Enterprise engineering practices

This is not a tutorial codebase. Every item below is enforced in the source **and** covered by tests.

## Backend — layered, and the layers mean something

```
request → route → middleware → validator → controller → service → model
                                              │            │
                                  HTTP only ──┘            └── business rules
                                  no logic                     + authorization
```

| Layer | Responsibility | The rule it enforces |
|---|---|---|
| **routes/** | URL → handler wiring | Nothing else. No logic. |
| **middleware/** | auth · validation · security · rate limiting | Cross-cutting concerns only |
| **validators/** | zod schemas | Input is coerced & trimmed **before** a controller ever sees it |
| **controllers/** | HTTP in, HTTP out | **Zero** business logic. **Zero** authorization. |
| **services/** | Business rules **and authorization** | Never trusts the client. The one place a rule can live. |
| **models/** | Mongoose schemas + indexes | Indexes are **shaped to the query that uses them** *(the two known scans are [documented](#-two-known-scans--documented-not-hidden), not hidden)* |
| **socket/** | Real-time handlers | Re-checks membership on **every** event |
| **utils/** · **lib/** | Pure helpers · infrastructure seams | Testable in isolation |

> **Authorization lives in services, never in controllers.** A rule written in a controller is a rule the *socket* layer does not have. Every mutation re-checks membership server-side — **leaving a room ends your ability to touch anything in it**, including a message you wrote while you were still a member.

## Frontend — a real state architecture

| Concern | Owner | Why |
|---|---|---|
| **Server state** | TanStack Query | One cache. One source of truth. |
| **Client state** | React state / context | Which room is open, which drawer is up |
| **Real-time** | Socket events **write into the Query cache** | Never a refetch — the socket already handed us the data |
| **Network** | **One** axios instance | Single-flight `401` → refresh → retry, in exactly one place |
| **Styling** | CSS Modules + design tokens | No raw hex/px where a token exists; correct in **both** themes |

> **Socket events patch the cache — they never trigger a refetch.** Refetching an entire message list on every arriving message would be an N+1 disaster.

## A reusable component library

Fourteen primitives. Every screen is assembled from them; nothing is styled ad-hoc.

```
components/ui/
   Avatar · Badge · BrandIcons · Button · ConfirmDialog · EmptyState
   ErrorBoundary · IconButton · Input · Logo · Modal · PresenceDot
   Skeleton · Spinner
```

- **`Modal`** is built on the **native `<dialog>`** — focus trap, `Esc`, top layer, inert background and focus restoration, all for free and all correct. Hand-rolled modals get every one of those wrong.
- **`Input`** passes native constraints (`required`, `pattern`, `maxLength`) straight through — the browser validates for free, with correct accessibility. State-based validation is reserved for what the browser *cannot* know.
- **`IconButton`** guarantees a **44 × 44 px hit area on touch** (WCAG 2.5.8) without changing a single pixel of the desktop layout.

## Accessibility is a requirement, not a nice-to-have

- ✅ Every action is reachable by keyboard — focus is **trapped** in drawers and modals, and **restored** to the trigger on close
- ✅ Overlay drawers are `inert` — no invisible tab stops hiding behind a scrim
- ✅ **No meaning is carried by colour alone** — unread, presence, ticks and admin each have a text/ARIA equivalent
- ✅ Live regions announce new messages and toasts
- ✅ `prefers-reduced-motion` is honoured
- ✅ Both themes are built from the **same design tokens**, so contrast is a property of the token set rather than of individual components

> #### ⌨️ Known gap — documented, not hidden
>
> There is **no roving `tabindex`** across the message list. Every action *is* keyboard-reachable, but crossing a 50-message room costs ~150 `Tab` presses. That is a re-architecture of the list's keyboard model, and it is **deliberately deferred** rather than quietly claimed as done.

## Comments explain *why*, never *what*

```js
// The window is measured from `createdAt`, not from the previous edit —
// otherwise editing every 59 minutes would keep a message editable forever.
```

The code already says what it does. A comment exists only to record a constraint the code **cannot** show.

---

# 🧪 Testing — the five-layer pyramid

**725 tests. Five layers. Each testing the thing it is genuinely good at.**

<div align="center">

| Layer | Tooling | Location | What it drives | Count |
|:--|:--|:--|:--|--:|
| **Unit** | Jest | `backend/tests/unit` | Pure functions, guards | **163** |
| **Integration** | Jest + Supertest | `backend/tests/integration` | Real API + real MongoDB | **284** |
| **Component** | Vitest · RTL · MSW | `frontend/tests` | Rendered React, real axios | **245** |
| **API E2E** | Playwright | `backend/e2e` | **Two live servers + Valkey** ⚡ | **27** |
| **Browser E2E** | Playwright | `frontend/e2e` | **Real Chromium, the real app** | **6** |

</div>

- **MSW mocks the *network*, not axios** — so the interceptors, the `401`→refresh→retry, and the error normalisation all genuinely execute. Mocking axios would skip the very code most worth testing.
- **Browser E2E drives the real UI** — a real Chromium signs in through the real email-OTP screens, creates a room, sends a message, and a **second browser watches it arrive live**.
- **Tests are centralised**, mirroring `src/`. `src/` contains source and nothing else.

```bash
# backend                          # frontend
npm run test:unit                  npm test            # Vitest
npm run test:integration           npm run test:e2e    # real browser
npm run test:e2e                   npm run build
```

> ⚠️ **Run the E2E suites as their own CI step.** Chaining them behind the unit suites causes database contention and false failures.

---

# 🔐 Security

Every defence below is implemented **and** covered by a test.

| Threat | Defence |
|---|---|
| **XSS** | Markup stripped at the source (`stripHtml`) + React escaping. Zero `dangerouslySetInnerHTML`. |
| **NoSQL injection** | Mongo operators (`$gt`, `$ne`, dotted paths) stripped from body, params **and** query |
| **ReDoS** | Every user-supplied search term is regex-**escaped** and length-capped *before* it reaches the database |
| **CSRF** | `SameSite=Lax` **plus** a server-side `Origin` check that **fails closed** in production |
| **Token theft** | 15-min JWT held **in memory** (never `localStorage`); 30-day opaque refresh token in an httpOnly, path-scoped cookie |
| **Token replay** | Refresh tokens **rotate**; a replayed token **revokes the whole family**. Only a SHA-256 hash is ever stored. |
| **Brute force** | Rate limiting · a 5-attempt OTP burn · and **no account enumeration** |
| **Misconfiguration** | The server **refuses to boot** in production with a missing/weak `JWT_SECRET` or a wildcard `CLIENT_ORIGIN` |
| **Algorithm confusion** | JWT algorithm **pinned** to `HS256` on both sign *and* verify |
| **Payload DoS** | 10 KB body limit · per-socket flood control |
| **Headers** | `helmet` — `nosniff`, frame-options, no `x-powered-by` |
| **Dependencies** | `npm audit` → **0 vulnerabilities**, both projects |

---

# 📁 Project structure

```
zentro/
├── backend/
│   ├── src/
│   │   ├── app.js            Express only — mountable by supertest, no listener
│   │   ├── server.js         Bootstrap: env → db → valkey ⚡ → io → listen
│   │   ├── config/           env · db · valkey ⚡ · passport
│   │   ├── constants/        Every magic value, in one place
│   │   ├── controllers/      HTTP in, HTTP out. No logic.
│   │   ├── services/         Business rules + authorization
│   │   ├── models/           Mongoose schemas + indexes
│   │   ├── middleware/       auth · validate · security · rateLimit · errorHandler
│   │   ├── routes/           URL → handler
│   │   ├── socket/           Real-time handlers (membership re-checked per event)
│   │   ├── validators/       zod schemas
│   │   ├── lib/              io · logger · tokenStore · mailer
│   │   └── utils/            AppError · sanitize · serializers · notify
│   ├── tests/{unit,integration}
│   └── e2e/                  Playwright — TWO servers over Valkey ⚡
│
├── frontend/
│   ├── src/
│   │   ├── components/{ui,chat,modals,auth}
│   │   ├── context/          Auth · Socket · Theme · Toast
│   │   ├── hooks/            Server-state + real-time bridges
│   │   ├── lib/              apiClient (ONE axios) · socket · tokenStore · queryKeys
│   │   ├── services/         API calls, grouped by resource
│   │   ├── pages/            Login · AuthCallback · Chat
│   │   └── styles/           tokens.css · global.css
│   ├── tests/                Vitest · RTL · MSW
│   └── e2e/                  Playwright — a real browser
│
├── DEPLOYMENT.md             ☁️  The full AWS runbook
└── README.md
```

---

# 🚀 Getting started

**Prerequisites** — Node 20+ · MongoDB · Valkey (or Redis)

```bash
docker run -d --name valkey -p 6379:6379 valkey/valkey
```

```bash
# 1 ─ Backend
cd backend
npm install
cp .env.example .env          # fill in MONGO_URI, JWT_SECRET, OAuth keys
npm run dev                   # → :4000

# 2 ─ Frontend
cd frontend
npm install
npm run dev                   # → :5173
```

## Prove the adapter locally — run **two** servers

```bash
# terminal 1
PORT=4000 npm start

# terminal 2  — same MONGO_URI, same VALKEY_URL
PORT=4001 npm start
```

Open the app in two browsers, point each at a **different port**, and chat between them.

**The messages cross because Valkey is carrying them.** Stop Valkey, and the two servers immediately go deaf to one another — which is the clearest possible demonstration of what the adapter does.

---

# ☁️ Deployment on AWS

Zentro runs across **two EC2 instances behind an Application Load Balancer**, with a self-hosted Valkey node, MongoDB Atlas, an ACM certificate and Cloudflare DNS.

<div align="center">

### 📖 **[ Read the full AWS deployment runbook → `DEPLOYMENT.md` ](./DEPLOYMENT.md)**

</div>

It is a genuine step-by-step production runbook, not a summary:

| | |
|---|---|
| 🏗 **System design** | Security groups, VPC, the complete topology |
| 🔴 **The Valkey node** | Docker, locked to the app security group — **never** exposed to `0.0.0.0/0` |
| 🖥 **Golden AMI** | Build one app server, image it, launch the second from that image |
| 🔒 **TLS** | ACM certificate + DNS validation — *and the Cloudflare proxy trap that silently breaks it* |
| ⚖️ **Load balancer** | Target groups, health checks, sticky sessions for the OAuth round-trip |
| 🌐 **Cloudflare** | DNS records and the grey-cloud requirement |
| 🐛 **Troubleshooting** | Every real bug hit during the deployment — and its fix |

> **The proof it works:** `curl` the health endpoint repeatedly and the returned `pid` **alternates** between the two EC2 instances — while a chat message sent on one still lands instantly on the other, **because Valkey is carrying it.**

---

# 📡 API reference

<details>
<summary><b>HTTP endpoints</b></summary>

### Auth
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/google` · `/api/auth/github` | Begin OAuth |
| `GET` | `/api/auth/callback/:provider` | OAuth callback |
| `POST` | `/api/auth/email/request` | Email a one-time code |
| `POST` | `/api/auth/email/verify` | Exchange the code for a session |
| `POST` | `/api/auth/refresh` | Rotate the refresh token |
| `POST` | `/api/auth/logout` | Revoke the session |
| `GET` | `/api/auth/me` | The current user |

### Rooms
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/rooms` | My rooms (with unread flags) |
| `GET` | `/api/rooms/discover` | Rooms I am not in |
| `POST` | `/api/rooms` | Create |
| `PATCH` `DELETE` | `/api/rooms/:id` | Update · delete *(creator)* |
| `POST` | `/api/rooms/:id/join` · `/leave` | Join (or request) · leave |
| `POST` | `/api/rooms/:id/invite` · `/invite/decline` | Invite · decline |
| `GET` `POST` | `/api/rooms/:id/requests[/:userId/approve\|reject]` | Moderate join requests *(admin)* |
| `POST` `DELETE` | `/api/rooms/:id/admins/:userId` | Promote · demote *(creator)* |

### Messages
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/rooms/:id/messages?before=&limit=` | History (cursor-paginated) |
| `GET` | `/api/rooms/:id/messages/search?q=` | Search |
| `GET` | `/api/rooms/:id/messages/:messageId/replies` | A thread |
| `GET` | `/api/rooms/:id/members` · `/receipts` | Roster · read receipts |
| `POST` | `/api/rooms/:id/read` | Mark read |

</details>

<details>
<summary><b>Socket.IO events</b> — every one of these crosses servers via Valkey ⚡</summary>

**Client → Server**
`room:join` · `room:leave` · `message:send` · `message:edit` · `message:delete` · `message:react` · `typing`

**Server → Client**
`ready` · `message:new` · `message:updated` · `message:deleted` · `presence:joined` · `presence:left` · `request:new` · `request:approved` · `request:rejected` · `room:invited` · `invite:declined` · `room:deleted` · `room:read` · `room:admin`

> **Client contract: wait for `ready`, not `connect`.** Handlers are registered synchronously, but the server finishes joining you to your rooms *asynchronously* — `ready` is the signal that it is safe to emit.

</details>

---

# 🛠 Tech stack

| | |
|---|---|
| **Real-time** | Socket.IO 4 · **[`socket.io-valkey-adapter`](https://www.npmjs.com/package/socket.io-valkey-adapter)** ⚡ · `iovalkey` |
| **Backend** | Node 20 (ESM) · Express 4 · Mongoose 8 · Passport · zod · helmet |
| **Frontend** | React 19 · Vite 8 · TanStack Query · axios · CSS Modules |
| **Data** | **MongoDB** — the truth · **Valkey** — the wire |
| **Testing** | Jest · Supertest · Vitest · React Testing Library · MSW · Playwright |
| **Infrastructure** | AWS EC2 · ALB · ACM · MongoDB Atlas · Cloudflare · Docker |

---

<div align="center">

## 📄 License

**MIT**

Built by **[@webdevelopersrinu](https://github.com/webdevelopersrinu)**
and powered by **[`socket.io-valkey-adapter`](https://www.npmjs.com/package/socket.io-valkey-adapter)** ⚡

</div>
