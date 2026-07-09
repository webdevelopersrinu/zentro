# 🚀 Zentro — AWS Deployment Guide

Complete, step-by-step record of how Zentro is deployed to AWS, from empty
account to `https://zentro.srinudesetti.in` serving live traffic across two
servers synced by Valkey.

> This document describes the **actual deployed system**, not a theoretical one.
> Every value here (region, instance types, security groups) matches production.

---

## 1. System design

```
                        ┌──────────────────────────────┐
                        │  Cloudflare DNS              │
                        │  zentro.srinudesetti.in      │
                        │  CNAME ──▶ ALB (DNS only)    │
                        └───────────────┬──────────────┘
                                        │ HTTPS :443
                        ┌───────────────▼──────────────┐
                        │  Application Load Balancer   │
                        │  • ACM TLS certificate       │
                        │  • Sticky sessions ON        │
                        │  • WebSocket support         │
                        │  • :80 → 301 → :443          │
                        │  • health check /api/health  │
                        └───────┬──────────────┬───────┘
                            :80 │              │ :80
                  ┌─────────────▼───┐    ┌─────▼───────────┐
                  │  EC2  app-base  │    │  EC2  app-2     │   Ubuntu, t2.small
                  │  172.31.12.241  │    │  172.31.0.157   │   (cloned from AMI)
                  ├─────────────────┤    ├─────────────────┤
                  │ Nginx :80       │    │ Nginx :80       │   serves frontend dist
                  │   ├─ / → dist   │    │   ├─ / → dist   │   proxies /api
                  │   ├─ /api → Node│    │   ├─ /api → Node│   proxies /socket.io
                  │   └─ /socket.io │    │   └─ /socket.io │   (WebSocket upgrade)
                  │ Node :4000 (pm2)│    │ Node :4000 (pm2)│
                  └────┬───────┬────┘    └────┬───────┬────┘
                       │       │              │       │
        VALKEY_URL     │       └──────────────┼───────┼──▶ MongoDB Atlas
   redis://172.31.15.198:6379                 │       │    (users/rooms/messages)
                       │                      │       │
                  ┌────▼──────────────────────▼───┐   │
                  │  EC2  zentro-valkey           │   │
                  │  172.31.15.198  (t2.micro)    │   │
                  │  Docker: valkey/valkey:8      │   │
                  │  :6379 — PRIVATE ONLY         │   │
                  └───────────────────────────────┘   │
                     pub/sub bus that syncs both      │
                     app servers in real time         │
```

### Why this shape

| Concern | Solution |
|---|---|
| WebSockets are stateful — a browser must stay on one server | **ALB sticky sessions** |
| But two browsers land on **different** servers | **Valkey pub/sub** relays messages between them |
| Where does chat data live? | **MongoDB Atlas** (shared by both servers) |
| How do both servers run identical code? | **Golden AMI** — build one, image it, clone |
| TLS + custom domain | **ACM cert on the ALB** + **Cloudflare CNAME** |

**The Valkey EC2 is the whole point of the project.** When user A (on `app-base`)
sends a message, that server `PUBLISH`es it to Valkey; `app-2` is subscribed,
receives it, and pushes it to user B over their WebSocket.

### Deployed resources

| Resource | Value |
|---|---|
| Region | **`ap-south-2`** (Hyderabad) |
| VPC | `vpc-0a50ff5aa401e9bd8` (default, `172.31.0.0/16`) |
| App servers | `zentro-app-base`, `zentro-app-2` — **t2.small**, Ubuntu |
| Valkey server | `zentro-valkey` — **t2.micro**, Ubuntu + Docker |
| Load balancer | `zentro-alb` (`zentro-alb-726367376.ap-south-2.elb.amazonaws.com`) |
| Target group | `zentro-tg` (HTTP:80, health `/api/health`, stickiness ON) |
| Certificate | ACM, `zentro.srinudesetti.in`, DNS-validated |
| Database | MongoDB Atlas |
| DNS | Cloudflare |

> ⚠️ All three EC2s currently sit in **`ap-south-2a`**. That's fine for a demo,
> but it means one AZ failure takes down everything. For real HA, put `app-2`
> in a different AZ.

---

## 2. Security groups

Create these **first** — they reference each other.

| SG | Inbound | Source | Purpose |
|---|---|---|---|
| `zentro-alb` | 80, 443 | `0.0.0.0/0` | public entry point |
| `zentro-app` | 80 | **`zentro-alb` SG** | only the ALB may reach the app |
| `zentro-app` | 22 | **My IP** | SSH admin |
| `zentro-valkey` | 6379 | **`zentro-app` SG** | only app servers may reach Valkey |
| `zentro-valkey` | 22 | **My IP** | SSH admin |
| MongoDB Atlas | — | both app EC2 **public IPs** | Atlas allowlist |

> 🔴 **Never open 6379 to `0.0.0.0/0`.** An internet-exposed Valkey with no
> password is compromised within minutes. Verify with:
> ```bash
> redis-cli -h <valkey-PRIVATE-ip> -p 6379 PING   # → PONG
> redis-cli -h <valkey-PUBLIC-ip>  -p 6379 PING   # → must HANG
> ```

---

## 3. Prerequisites

**MongoDB Atlas**
1. Create a cluster + database user.
2. **Network Access** → add each app EC2's **public IP** (do this for *every*
   instance, including AMI clones — they each get a new IP).
3. **Connect → Drivers** → copy the SRV string, append `/chatapp`:
   ```
   mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/chatapp?retryWrites=true&w=majority
   ```

**Google OAuth** — [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client ID (Web)
- Authorized JavaScript origin: `https://zentro.srinudesetti.in`
- Authorized redirect URI: `https://zentro.srinudesetti.in/api/auth/callback/google`
- *(Google allows multiple URIs — keep `http://localhost:4000/...` for dev.)*

**GitHub OAuth** — [github.com/settings/developers](https://github.com/settings/developers) → New OAuth App
- Homepage URL: `https://zentro.srinudesetti.in`
- Authorization callback URL: `https://zentro.srinudesetti.in/api/auth/callback/github`
- ⚠️ GitHub allows **only ONE** callback URL. Create a *second* OAuth App for
  localhost dev.
- Leave **"Enable Device Flow" unchecked** — that's for CLIs/TVs, not web apps.

**Secrets**
```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # SESSION_SECRET
```

---

## 4. Step 1 — The Valkey server (build this FIRST)

The app servers need its private IP, so it must exist first.

**Launch:** Ubuntu, **t2.micro**, 8 GB, SG `zentro-valkey`, public IP enabled (SSH only).

```bash
ssh -i ~/path/to/key.pem ubuntu@<VALKEY_PUBLIC_IP>

sudo apt update && sudo apt install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu

# ⚠️ Group membership only applies to a NEW login session:
exit
ssh -i ~/path/to/key.pem ubuntu@<VALKEY_PUBLIC_IP>

docker run -d --name valkey --restart unless-stopped \
  -p 6379:6379 valkey/valkey:8-alpine

docker ps                                  # → Up
docker exec -it valkey valkey-cli PING     # → PONG
```

`--restart unless-stopped` makes it survive reboots.

**Note the PRIVATE IPv4** (e.g. `172.31.15.198`) from the EC2 console. That is
your `VALKEY_URL` host — **never the public IP**. Private IPs are stable across
reboots and keep traffic inside the VPC (free + secure).

```ini
VALKEY_URL=redis://172.31.15.198:6379
```

---

## 5. Step 2 — The app base server

**Launch:** Ubuntu, **t2.small** (2 GB — 1 GB OOMs during the Vite build),
**16 GB gp3**, SG `zentro-app`, public IP enabled.

> Using t2.micro anyway? Add swap first:
> ```bash
> sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
> sudo mkswap /swapfile && sudo swapon /swapfile
> echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
> ```

**Clone to the exact path** (the setup script expects `/var/www/zentro`):
```bash
sudo mkdir -p /var/www/zentro && sudo chown -R ubuntu:ubuntu /var/www/zentro
git clone https://github.com/webdevelopersrinu/zentro.git /var/www/zentro
```
⚠️ Run `git clone <url> /var/www/zentro` — **not** `cd /var/www/zentro && git clone <url>`,
which nests it at `/var/www/zentro/zentro` and breaks the script.

**Run the setup script** — it stops and asks for `.env`:
```bash
cd /var/www/zentro
bash scripts/setup-ec2.sh
```

**Create `backend/.env`:**
```bash
nano /var/www/zentro/backend/.env
```
```ini
NODE_ENV=production
PORT=4000
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/chatapp?retryWrites=true&w=majority
VALKEY_URL=redis://172.31.15.198:6379
JWT_SECRET=<openssl rand -hex 32>
SESSION_SECRET=<openssl rand -hex 32>
SERVER_URL=https://zentro.srinudesetti.in
CLIENT_URL=https://zentro.srinudesetti.in
CLIENT_ORIGIN=https://zentro.srinudesetti.in
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```
⚠️ Paste **real values**. A literal `172.31.x.x` placeholder produces
`getaddrinfo ENOTFOUND 172.31.x.x` in the logs.

**Re-run the script** — it installs deps, builds the frontend, starts pm2, and
writes the Nginx config:
```bash
bash scripts/setup-ec2.sh
```

**Verify:**
```bash
curl http://localhost:4000/health          # → {"ok":true,"pid":...}
curl http://localhost/api/health           # → same, but through Nginx
redis-cli -h 172.31.15.198 -p 6379 PING    # → PONG
pm2 logs zentro-api --lines 15             # → ✅ MongoDB + ✅ Valkey, no errors
```

> `pm2 logs` prints the **historical** log file. After fixing anything, run
> `pm2 flush zentro-api` first, then restart, or you'll keep seeing old errors.

### What the script configures

**pm2** — process manager, `--cwd /var/www/zentro/backend`, with
`pm2 startup` + `pm2 save` so it resurrects on boot.

**Nginx** — one server block doing three jobs:
```nginx
location /          { try_files $uri $uri/ /index.html; }   # SPA + static build
location /api/      { proxy_pass http://127.0.0.1:4000; }   # REST API
location /socket.io/ {                                       # WebSockets
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```
It forwards `X-Forwarded-Proto` from the ALB so Express (`trust proxy`) knows the
original request was HTTPS — required for the secure session cookie during OAuth.

---

## 6. Step 3 — Golden AMI → second server

Both app servers run **identical code and identical `.env`** (all state lives in
Atlas + Valkey), so build one and clone it.

1. **EC2 → Instances** → select `zentro-app-base`
2. **Actions → Image and templates → Create image**
   - Name `zentro-app-v1`
   - ✅ **Check "Reboot instance"** (ensures a consistent snapshot)
3. **Images → AMIs** → wait for **Available**
4. Select it → **Launch instance from AMI**
   - Name `zentro-app-2`, **t2.small**, same VPC, SG `zentro-app`, public IP on

It boots **already running** — pm2 and Nginx auto-start.

```bash
pm2 status                        # zentro-api online, 0 restarts
curl http://localhost/api/health
```

**Per-instance tasks (NOT baked into the image):**
- Add the new instance's **public IP to Atlas → Network Access**
- Register it in the ALB target group

> 🔒 The AMI contains `backend/.env` with all your secrets. **Keep it private** —
> never use "Modify Image Permissions → Public".
>
> 🔁 After any code fix, create `zentro-app-v2`. A stale AMI means new instances
> launch with old bugs.

---

## 7. Step 4 — TLS certificate (ACM)

Must be in the **same region as the ALB** (`ap-south-2`).

1. **ACM → Request certificate → Public certificate**
2. Domain: `zentro.srinudesetti.in`
3. **DNS validation**, Key algorithm **RSA 2048**, Export **disabled**
4. Open the certificate → **Domains** → copy the **CNAME name** and **CNAME value**
   (use the copy buttons — a single typo means it never validates)
5. Add it in Cloudflare (see next section)
6. Status flips **Pending validation → Issued** in 2–10 min

> Keep that CNAME in Cloudflare **forever** — ACM re-checks it to auto-renew.

---

## 8. Step 5 — Load balancer

### Target group
**EC2 → Target Groups → Create**

| Field | Value |
|---|---|
| Target type | Instances |
| Protocol : Port | **HTTP : 80** |
| VPC | `vpc-0a50ff5aa401e9bd8` |
| Protocol version | HTTP1 |
| **Health check path** | **`/api/health`** |
| Name | `zentro-tg` |

Register **both app EC2s** on port 80. **Do not register the Valkey instance** —
it serves no HTTP.

Then **Attributes → Edit**:
- ☑ **Turn on stickiness**
- Type: **Load balancer generated cookie**
- Duration: **1 day**
- Cross-zone LB: **Inherit from load balancer** (on)

> **Stickiness is mandatory.** Without it, a browser's Socket.IO polling and
> WebSocket handshake requests bounce between servers and the connection fails.

### The ALB
**EC2 → Load Balancers → Create → Application Load Balancer**

| Field | Value |
|---|---|
| Name | `zentro-alb` |
| Scheme | **Internet-facing** |
| IP type | IPv4 |
| VPC | `vpc-0a50ff5aa401e9bd8` |
| **Mappings** | **at least 2 AZs** (`ap-south-2a` + one more) — AWS requires it |
| Security group | **`zentro-alb`** (remove `default` if auto-added) |
| Listener | **HTTPS : 443** → forward to `zentro-tg` |
| Certificate | From ACM → `zentro.srinudesetti.in` |

Skip the CloudFront/WAF/Global-Accelerator integrations, and leave the
listener-level "target group stickiness" **off** (that's for multiple target
groups; you already set target-level stickiness).

**After creation, add the redirect listener:**
**Listeners and rules → Add listener**
- **HTTP : 80** → Routing action **Redirect to URL** → `HTTPS` / `443` → **301**
- Leave host/path/query at their `#{...}` defaults so paths are preserved.

**Verify before touching DNS:**
```bash
ALB=zentro-alb-726367376.ap-south-2.elb.amazonaws.com
for i in 1 2 3 4; do curl -sk https://$ALB/api/health; echo; done
# pid must ALTERNATE between the two EC2s → load balancing works
curl -I http://$ALB/     # → 301, Location: https://...
```
*(`-k` is expected: the cert is for your domain, not the ALB hostname.)*

Confirm **Target Groups → zentro-tg → Targets** shows both **healthy**.

---

## 9. Step 6 — Connect the domain (Cloudflare)

You need **only one** DNS provider. Since the domain is on Cloudflare,
**Route 53 is unnecessary** — skip it (and save the hosted-zone fee). Route 53's
alias-record advantage only matters for an apex domain; `zentro` is a subdomain,
so a plain CNAME works.

### Record 1 — ACM validation
| Field | Value |
|---|---|
| Type | **CNAME** |
| Name | `_<hash>.zentro` *(omit `.srinudesetti.in` — Cloudflare appends the zone)* |
| Target | `_<hash>.<hash>.acm-validations.aws.` |
| **Proxy status** | **DNS only (grey cloud)** |

### Record 2 — the application
| Field | Value |
|---|---|
| Type | **CNAME** |
| Name | `zentro` |
| Target | `zentro-alb-726367376.ap-south-2.elb.amazonaws.com` |
| **Proxy status** | **DNS only (grey cloud)** to start |

### 🔴 The #1 Cloudflare gotcha
If **Proxy status is orange (Proxied)**, Cloudflare **rejects** the ACM
validation record outright:
```
Target ..._acm-validations.aws. is not allowed for a proxied record.
```
The save **fails silently from the user's perspective** — the record is never
created, and ACM sits at "Pending validation" forever. **Toggle to DNS only
before clicking Save.**

**Verify the record actually published:**
```bash
nslookup -type=CNAME _<hash>.zentro.srinudesetti.in 1.1.1.1
# must return the acm-validations target, not "Non-existent domain"
```

### Optional: enable the Cloudflare proxy later
Once everything works DNS-only, you may switch the **app** record to
**Proxied (orange)** for CDN/WAF/DDoS protection. If you do:
- Set **SSL/TLS → Overview → Full (strict)**. Anything else (especially
  *Flexible*) creates an infinite redirect loop against the ALB's 80→443 rule.
- WebSockets pass through Cloudflare fine.
- ALB stickiness still works (it uses its own `AWSALB` cookie).
- Note: `nslookup zentro.srinudesetti.in` will then return **Cloudflare** IPs
  (`104.21.x.x`), not the ALB's — that's how you can tell the proxy is on.

### Final verification
```bash
curl https://zentro.srinudesetti.in/api/health          # no -k needed → valid cert
curl -sI https://zentro.srinudesetti.in/api/auth/google | grep -i location
# → 302 to accounts.google.com with redirect_uri=https://zentro.srinudesetti.in/...
```

---

## 10. Step 7 — Lock it down

Once traffic flows through the ALB, remove the temporary public access:

**`zentro-app` SG → Inbound rules**
- ❌ Delete `HTTP 80` from `0.0.0.0/0`
- ✅ Add `HTTP 80` with **Source = `zentro-alb` security group**
- ✅ Keep `SSH 22` from **My IP**

Re-test `curl https://zentro.srinudesetti.in/api/health` — still works, and the
EC2s are no longer directly reachable from the internet.

---

## 11. Deploying updates

On **each** app EC2:
```bash
cd /var/www/zentro && git pull
cd frontend && npm install && npm run build
cd ../backend && npm install --omit=dev
pm2 restart zentro-api --update-env
```

Then re-image (`zentro-app-v2`) so new instances get the current code.

---

## 12. Troubleshooting — every issue we actually hit

| Symptom | Cause | Fix |
|---|---|---|
| `permission denied ... docker.sock` | `usermod -aG docker` doesn't affect the current shell | Log out and back in (or `newgrp docker`) |
| `destination path '/var/www/zentro' already exists` | cloned *inside* the target dir, nesting it | `sudo rm -rf /var/www/zentro`, then `git clone <url> /var/www/zentro` |
| `502 Bad Gateway` from Nginx | Node isn't listening on :4000 | `pm2 logs zentro-api` — usually Mongo or Valkey |
| `uri parameter to openUri() ... got "undefined"` | dotenv resolves `.env` from **cwd**; pm2 started elsewhere | fixed by `src/config/env.js` (absolute path); also `pm2 start --cwd backend` |
| `MongooseServerSelectionError` | EC2's public IP not in Atlas allowlist | Atlas → Network Access → add `curl -s ifconfig.me` |
| `Valkey pub error: getaddrinfo ENOTFOUND 172.31.x.x` | placeholder pasted literally into `.env` | use the real private IP |
| `Valkey ... ECONNREFUSED` | SG doesn't allow 6379 from the app SG | add the inbound rule |
| **`Unknown authentication strategy "google"`** | **ESM hoists all `import`s above body code**, so `passport.js` read `process.env` *before* a body-level `dotenv.config()` ran → no credentials → `passport.use()` skipped | `import "./config/env.js"` as the **first import** in `server.js` |
| `/api/health` 404 but `/health` works | Nginx forwards the `/api` prefix unchanged | backend serves **both** paths |
| ACM stuck "Pending validation" | Cloudflare refused the **proxied** CNAME; record never saved | set **DNS only** before saving; verify with `nslookup` |
| `redirect_uri is not associated with this application` (GitHub) | callback URL not registered | GitHub OAuth App → set callback to the prod URL (only one allowed) |
| `redirect_uri_mismatch` (Google) | same, for Google | add the prod redirect URI (Google allows several) |
| Old errors keep appearing in `pm2 logs` | it prints the historical log file | `pm2 flush zentro-api`, then restart |
| Visiting `/api/auth/callback/github` directly → 500 | that URL needs `code`+`state` from the provider | not a bug — start at `/api/auth/google` or click the button |

### The ESM ordering bug, explained
```js
// ❌ BROKEN — imports are hoisted; dotenv.config() runs LAST
import dotenv from "dotenv";
dotenv.config({ path: "..." });
import passport from "./config/passport.js";   // reads process.env → undefined

// ✅ CORRECT — env.js is an import, so it evaluates first
import "./config/env.js";
import passport from "./config/passport.js";   // reads process.env → populated
```
This is why **MongoDB connected but OAuth failed**: `MONGO_URI` is read in the
server.js *body* (after imports), while `GOOGLE_CLIENT_ID` is read at
`passport.js` *module top-level* (during imports).

---

## 13. Verifying the Valkey sync (the point of the project)

```bash
# terminal 1 — on the Valkey EC2
docker exec -it valkey valkey-cli MONITOR
```
Send a chat message from the app. You'll see `PUBLISH socket.io#...` scroll by —
that's one EC2 broadcasting to the other.

Also useful:
```bash
docker exec -it valkey valkey-cli PUBSUB CHANNELS '*'
# → socket.io-request#/#, socket.io-response#/#   (the adapter's channels)
```

> **`KEYS *` will be empty.** Valkey here is a *message bus*, not a data store —
> pub/sub messages pass through and are gone. Chat data lives in MongoDB.

To confirm two browsers are on different servers, open
`https://zentro.srinudesetti.in/api/health` in each — the `pid` values differ.

---

## 14. Known gaps / TODO

- [ ] **The chat UI still uses `frontend/src/utils/mockStore.js`.** Login
      (ThunderID/JWT) is real, but rooms, messages, members, and typing are
      simulated in the browser. The Socket.IO + Valkey path is deployed and
      verified at the infrastructure level, but **`Chat.jsx` is not yet wired to
      the backend.** This is the next development task.
- [ ] **Rotate all secrets.** The Mongo password was committed to the public repo
      (it remains in git history), and the OAuth client secrets were exposed.
      Rotate: Atlas password, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`,
      then update `.env` on both EC2s and re-image.
- [ ] Move `.env` values into **AWS SSM Parameter Store** / Secrets Manager so
      they never live in files, git, or AMIs.
- [ ] Spread the EC2s across **multiple AZs** (all three are in `ap-south-2a`).
- [ ] Valkey is a **single point of failure** with no persistence and no auth
      (SG-only protection). Consider ElastiCache, or add `requirepass` + a replica.
- [ ] Automate deploys (GitHub Actions / CodeDeploy) instead of `git pull` on
      each box.
- [ ] Public/private rooms + invite-accept notifications (designed, not built).

---

## 15. Cost estimate (ap-south-2, on-demand)

| Item | Monthly |
|---|---|
| 2 × t2.small (app) | ~$34 |
| 1 × t2.micro (Valkey) | ~$8 |
| Application Load Balancer | ~$18 + LCU |
| MongoDB Atlas M0 | free |
| ACM certificate | free |
| Cloudflare DNS | free |
| **Total** | **≈ $60/mo** |