# TRIXI Backend: Production Server Hardware & Infrastructure Specification Sheet

This document outlines the official server hardware, operating system, runtime, database, network, and background service requirements for purchasing and provisioning the production environment for the **TRIXI** card game backend.

---

## 1. Hardware Sizing Recommendations

Trix is a real-time multiplayer game maintaining persistent WebSocket connections for each active player. Hardware requirements scale primarily with **Concurrent Connected Players (CCU)**.

### Tier Comparison Table

| Specification | Tier 1: Starter / MVP<br/>*(Up to 1,000 CCU / ~250 Tables)* | Tier 2: Recommended Production<br/>*(1,000 – 5,000 CCU / ~1,250 Tables)* | Tier 3: High-Traffic Scale<br/>*(5,000 – 15,000+ CCU)* |
| :--- | :--- | :--- | :--- |
| **CPU (Compute)** | **2 vCPU** (x86_64, modern Intel/AMD) | **4 vCPU** (Dedicated vCPU recommended) | **8+ vCPU** (Compute Optimized) |
| **RAM (Memory)** | **4 GB** DDR4 / DDR5 | **8 GB** DDR4 / DDR5 | **16 GB – 32 GB** DDR5 |
| **Storage (Disk)** | **40 GB** NVMe SSD | **80 GB – 100 GB** NVMe SSD | **160 GB+** NVMe SSD (RAID-1) |
| **Network Uplink** | 1 Gbps | 1 Gbps | 1 Gbps / 10 Gbps Dedicated |
| **Bandwidth** | 2 TB / month | 5 TB / month | 10 TB+ / Unmetered |
| **Estimated Cost** | ~$15 – $25 / month | ~$40 – $60 / month | ~$100 – $180 / month |

> **Recommendation**: For initial commercial rollout, **Tier 2 (4 vCPU / 8 GB RAM / 80 GB NVMe)** is recommended to provide ample buffer for simultaneous WebSocket keep-alives, PostgreSQL connection pooling, and in-memory Redis matchmaking.

---

## 2. Operating System & Kernel Specifications

- **Recommended OS**: **Ubuntu 22.04 LTS** (Jammy Jellyfish) or **Ubuntu 24.04 LTS** (Noble Numbat) 64-bit x86_64.
- **Alternative Supported OS**: Debian 12 (Bookworm).
- **Linux Kernel**: v5.15+ or v6.8+ (required for `epoll` multi-socket multiplexing).
- **Architecture**: `x86_64` (AMD64) or `arm64` (AWS Graviton / Ampere).

### Mandatory Kernel & File Descriptor Parameters
Since every WebSocket connection consumes an open file descriptor, the OS must be configured to prevent socket exhaustion:
- **Max Open Files (`nofile`)**: `65,535` (set in `/etc/security/limits.conf`).
- **System File Limit (`fs.file-max`)**: `2,097,152`.
- **Max Socket Backlog (`net.core.somaxconn`)**: `65,535`.
- **TCP Reuse (`net.ipv4.tcp_tw_reuse`)**: `1`.

---

## 3. Web Server & Reverse Proxy Specifications

- **Web Server**: **NGINX** (v1.24+ or `nginx:alpine`).
- **SSL / TLS**: TLS v1.2 and TLS v1.3 with automated Let's Encrypt certificates (via Certbot).
- **WebSocket Gateway Proxying**:
  - Endpoint `/socket.io/` with HTTP/1.1 upgrade headers (`Upgrade $http_upgrade`, `Connection "upgrade"`).
  - Extended keep-alive buffer: `proxy_read_timeout 300s;` and `proxy_send_timeout 300s;` (prevents player disconnects during turn contemplation).
  - Worker connection limit: `worker_connections 65535;`.
- **Gzip Compression**: Enabled for static REST API responses.

---

## 4. Runtimes & Database Versions

### 4.1 Application Runtime
- **Node.js**: **v20.x LTS (Iron)** or **v22.x LTS**.
- **Node Execution Mode**: NodeNext module resolution (`dist/main.js`).
- **Process Manager**: Docker container runtime or `pm2` cluster mode if bare-metal.

### 4.2 Primary Relational Database
- **Database Engine**: **PostgreSQL v16.x** (or v15.x).
- **Driver Adapter**: Native connection pooling via `@prisma/adapter-pg` with `pg.Pool` (connection pool sizing: 20–50 connections).
- **Extensions**: `uuid-ossp` or `pgcrypto` (built into PostgreSQL 16).
- **Storage**: Persistent volume mounted to high-IOPS NVMe drive.

### 4.3 In-Memory Cache & Message Broker
- **Cache Engine**: **Redis v7.x** (`redis:7-alpine`).
- **Persistence**: Append-Only File enabled (`--appendonly yes`) + periodic RDB snapshots.
- **Dedicated Memory**: Minimum 512 MB – 1 GB reserved for matchmaking sets and leaderboard caching.

---

## 5. Required OS Packages & System Extensions

When purchasing and setting up the server, ensure the following utilities and build packages can be installed:

```bash
# Core Utilities
curl, wget, git, htop, ufw, ca-certificates, gnupg

# Container Infrastructure
docker-ce, docker-ce-cli, containerd.io, docker-compose-plugin (Docker Compose v2)

# SSL & Security
certbot, python3-certbot-nginx, openssl

# Build Toolchain (only for native compilation during image builds)
make, gcc, g++, python3
```

---

## 6. Background Services & Daemons

The server will run the following 4 containerized services managed via Docker Compose (`docker-compose.prod.yml`):

| Service | Container Name | Base Image | Role | Port (Internal) | Port (Public) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`app`** | `trix_backend_app` | Node 20 Alpine | Core NestJS Backend & Socket.IO Engine | `3000` | Blocked (Proxied) |
| **`postgres`** | `trix_postgres` | `postgres:16-alpine` | Relational Player & Match Database | `5432` | Blocked (Internal) |
| **`redis`** | `trix_redis` | `redis:7-alpine` | Matchmaking Queue & Session Store | `6379` | Blocked (Internal) |
| **`nginx`** | `trix_nginx` | `nginx:alpine` | SSL Termination & WebSocket Proxy | `80`, `443` | **`80`, `443` (Open)** |

### Systemd & Cron Daemons:
- **`docker.service`**: Systemd daemon configured to auto-restart on system reboot.
- **Certbot Renewal Cron**: Automated daily check to renew SSL certificates before the 90-day expiry window.
- **Automated Database Backup**: Nightly `pg_dump` cron exporting compressed database snapshots to local storage or an offsite S3 bucket.

---

## 7. Firewall & Network Port Configuration

The server's firewall (`UFW` or Cloud Security Group) must be configured strictly as follows:

| Port | Protocol | Source | Purpose | Status |
| :--- | :--- | :--- | :--- | :--- |
| **`22`** | TCP | Admin IPs (or 0.0.0.0/0) | Secure Shell (SSH) Remote Server Access | **OPEN** |
| **`80`** | TCP | 0.0.0.0/0 (Public) | HTTP (Let's Encrypt Validation & HTTPS Redirect) | **OPEN** |
| **`443`** | TCP | 0.0.0.0/0 (Public) | HTTPS REST API & Secure WSS WebSockets | **OPEN** |
| **`3000`** | TCP | Internal Docker Network | NestJS Backend Direct Port | **BLOCKED** |
| **`5432`** | TCP | Internal Docker Network | PostgreSQL Database Direct Port | **BLOCKED** |
| **`6379`** | TCP | Internal Docker Network | Redis In-Memory Cache Direct Port | **BLOCKED** |

---

## 8. Recommended Cloud & VPS Hosting Providers

The client can purchase a Virtual Private Server (VPS) or Cloud Instance from any of the following recommended cloud vendors:

1. **DigitalOcean**:
   - Plan: *Regular or Premium Intel/AMD Droplet* (4 vCPU / 8 GB RAM / 160 GB SSD) — ~$48/month.
2. **Hetzner Cloud**:
   - Plan: *CPX31* (4 vCPU AMD, 8 GB RAM, 160 GB NVMe) — ~€14/month *(Best price-to-performance)*.
3. **AWS (Amazon Web Services)**:
   - Plan: `t4g.xlarge` (4 vCPU, 16 GB RAM) or `c6i.large` (2 vCPU, 4 GB RAM Compute Optimized).
4. **Linode / Akamai Cloud**:
   - Plan: *Dedicated 4 GB or Shared 8 GB* — ~$40/month.
