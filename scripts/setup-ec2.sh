#!/usr/bin/env bash
#
# Zentro — one-shot EC2 setup (base "golden" instance).
# Installs Nginx + Node + pm2, clones the app, builds the frontend, starts the
# backend, and configures Nginx. Run this ONCE on the base instance, verify it,
# then create an AMI and launch the 2nd instance from that image.
#
# USAGE:
#   1) Edit REPO_URL below (or pass it: REPO_URL=... ./setup-ec2.sh)
#   2) scp/create your secrets first is NOT needed — the script pauses and tells
#      you where to put backend/.env and frontend/.env, then re-run.
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/<you>/<zentro-repo>.git}"
APP_DIR="/var/www/zentro"
DOMAIN="zentro.srinudesetti.in"

echo "▸ 1/6 System packages (Nginx, Git, Node 20, pm2)"
sudo apt-get update -y
sudo apt-get install -y nginx git curl
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo npm i -g pm2

echo "▸ 2/6 Fetch code into $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull
fi

# --- secrets gate -----------------------------------------------------------
if [ ! -f "$APP_DIR/backend/.env" ]; then
  cat <<EOF

⛔ backend/.env is missing. Create it now (same values will be baked into the AMI
   and reused by BOTH instances), then re-run this script:

   nano $APP_DIR/backend/.env
   # NODE_ENV=production
   # PORT=4000
   # MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/chatapp
   # VALKEY_URL=redis://<elasticache-endpoint>:6379
   # JWT_SECRET=<openssl rand -hex 32>
   # SESSION_SECRET=<openssl rand -hex 32>
   # SERVER_URL=https://$DOMAIN
   # CLIENT_URL=https://$DOMAIN
   # CLIENT_ORIGIN=https://$DOMAIN
   # GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET

EOF
  exit 1
fi

echo "▸ 3/6 Build frontend (static files served by Nginx)"
echo "VITE_API_URL=/api" > "$APP_DIR/frontend/.env"   # same-domain API path
( cd "$APP_DIR/frontend" && npm install && npm run build )

echo "▸ 4/6 Install backend deps + start with pm2"
( cd "$APP_DIR/backend" && npm install --omit=dev )
pm2 delete zentro-api >/dev/null 2>&1 || true
# --cwd matters: dotenv resolves .env relative to the working directory.
pm2 start "$APP_DIR/backend/src/server.js" --name zentro-api --cwd "$APP_DIR/backend"
pm2 save
# Make pm2 resurrect the process on every boot (crucial: the AMI clone inherits this)
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | bash || true
pm2 save

echo "▸ 5/6 Nginx site (serve frontend + proxy /api + /socket.io with WS upgrade)"
sudo tee /etc/nginx/sites-available/zentro >/dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $APP_DIR/frontend/dist;
    index index.html;
    location / { try_files \$uri \$uri/ /index.html; }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_read_timeout 3600s;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/zentro /etc/nginx/sites-enabled/zentro
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable nginx && sudo systemctl restart nginx

echo "▸ 6/6 Verify"
sleep 2
curl -fsS http://localhost/api/health && echo "" && echo "✅ Base instance ready."
echo "   Next: create an AMI from THIS instance, then launch instance #2 from it."
