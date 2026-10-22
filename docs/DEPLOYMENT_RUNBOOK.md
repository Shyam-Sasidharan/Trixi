# TRIXI Backend: Production Deployment Runbook

This runbook outlines the exact step-by-step procedure for deploying the **TRIXI** backend to a production Linux VPS (Ubuntu 22.04 / 24.04 LTS).

---

## 1. Server Hardware & OS Prerequisites

- **Compute**: Minimum 2 vCPU, 4GB RAM (8GB+ recommended for 5,000+ concurrent players).
- **Disk**: 40GB+ NVMe SSD.
- **Operating System**: Ubuntu 22.04 LTS or 24.04 LTS.
- **Networking**: Ports `80` (HTTP), `443` (HTTPS), and `22` (SSH) open in firewall.

---

## 2. Linux Kernel & File Descriptor Optimization

WebSockets maintain persistent TCP sockets for every connected player. Standard Linux defaults (1,024 open files) will cause socket exhaustion under load.

### 2.1 Increase System File Limits
Edit `/etc/security/limits.conf`:
```bash
sudo bash -c 'cat >> /etc/security/limits.conf <<EOF
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF'
```

### 2.2 Optimize Sysctl TCP Parameters
Edit `/etc/sysctl.conf`:
```bash
sudo bash -c 'cat >> /etc/sysctl.conf <<EOF
fs.file-max = 2097152
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
EOF'

# Apply immediately
sudo sysctl -p
```

---

## 3. Install Docker Engine & Docker Compose

```bash
# Update repositories
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker packages
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify Docker installation
sudo docker --version
sudo docker compose version
```

---

## 4. Codebase Deployment & Configuration

```bash
# Clone the repository
git clone https://github.com/Shyam-Sasidharan/Trixi.git /opt/trix-backend
cd /opt/trix-backend

# Create production environment file
cp .env.example .env
nano .env
```

### Configure `.env`:
```env
PORT=3000
NODE_ENV=production

# Database Credentials
POSTGRES_USER=trix_admin
POSTGRES_PASSWORD=YourStrongDatabasePassword123!
POSTGRES_DB=trix_db
DATABASE_URL="postgresql://trix_admin:YourStrongDatabasePassword123!@postgres:5432/trix_db?schema=public"

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Cryptographic Keys (Generate with: openssl rand -base64 48)
JWT_SECRET=Wv3oK41eM58fJ92Lz...
JWT_REFRESH_SECRET=7yR1b8X9m2P5tQ4v...
```

---

## 5. SSL / TLS Setup with Let's Encrypt

Create directory for certificates:
```bash
mkdir -p /opt/trix-backend/ssl
```

Obtain certificates with Certbot:
```bash
sudo apt-get install -y certbot

# Stop any process on port 80 temporarily
sudo certbot certonly --standalone -d api.trixi.yourdomain.com

# Copy or symlink certificates into ./ssl directory
sudo cp /etc/letsencrypt/live/api.trixi.yourdomain.com/fullchain.pem /opt/trix-backend/ssl/
sudo cp /etc/letsencrypt/live/api.trixi.yourdomain.com/privkey.pem /opt/trix-backend/ssl/
sudo chmod 644 /opt/trix-backend/ssl/*
```

---

## 6. Build and Launch Production Stack

```bash
cd /opt/trix-backend

# Build images and start all 4 containers (app, postgres, redis, nginx)
docker compose -f docker-compose.prod.yml up -d --build
```

### Check Container Status
```bash
docker compose -f docker-compose.prod.yml ps
```
Output should show all services healthy:
```text
NAME                IMAGE               COMMAND                  SERVICE             STATUS
trix_backend_app    trixi-backend-app   "node dist/main.js"      app                 Up (healthy)
trix_nginx          nginx:alpine        "/docker-entrypoint.…"   nginx               Up
trix_postgres       postgres:16-alpine  "docker-entrypoint.s…"   postgres            Up (healthy)
trix_redis          redis:7-alpine      "docker-entrypoint.s…"   redis               Up (healthy)
```

---

## 7. Apply Database Migrations in Production

Run Prisma migration push inside the running container:
```bash
docker compose -f docker-compose.prod.yml exec app npx prisma db push
```

---

## 8. Verifying Deployment & Health Checks

Probe the live health endpoint:
```bash
curl -I https://api.trixi.yourdomain.com/health
```

Expected response:
```json
{
  "status": "ok",
  "postgres": "connected",
  "redis": "connected",
  "activeRooms": 0,
  "uptimeSeconds": 45,
  "memory": {
    "heapUsedMB": "38.25",
    "heapTotalMB": "44.10",
    "rssMB": "85.40"
  },
  "timestamp": "2026-10-22T12:00:00.000Z"
}
```

---

## 9. Logging, Maintenance & Rollbacks

- **Live Logs**:
  ```bash
  docker compose -f docker-compose.prod.yml logs -f app
  ```
- **Restarting Application**:
  ```bash
  docker compose -f docker-compose.prod.yml restart app
  ```
- **Rolling Update**:
  ```bash
  git pull origin main
  docker compose -f docker-compose.prod.yml up -d --no-deps --build app
  ```
