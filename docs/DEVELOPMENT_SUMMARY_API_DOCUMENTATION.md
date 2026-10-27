# TRIXI Backend — Recent Development & Complete API Reference Documentation

**Author / Team:** Trix Backend Architecture Team  
**Date:** October 26–27, 2026  
**Environment:** Node.js (v20 ESM) / NestJS / Prisma / PostgreSQL / Redis / Socket.IO  

---

## Executive Summary of Recent Development

Over the last development cycle, the TRIXI backend was upgraded with major enterprise capabilities:

1. **Dual-Identifier Authentication (`/auth`)**:
   - Seamless sign-in and sign-up with either an **Email Address** OR a **Mobile Phone Number** (or a unified `"identifier"` field for mobile apps).
   - Automatic phone normalization (E.164 format).
   - Redis token revocation/blacklisting on logout with PostgreSQL refresh token rotation.
2. **Autonomous Game Bot AI & Real-Time Decision Engine (`src/bot/`)**:
   - High-performance heuristic decision engine covering all 5 Trix contracts (`QUEENS`, `KING_OF_HEARTS`, `DIAMONDS`, `HANDS`, `TRIX`).
   - Strategic contract picking for Free Mercy and Crazy Complex kingdoms.
   - Risk-aware card doubling engine for Queens and King of Hearts.
3. **Automated Matchmaking Backfill (`BotFillService`)**:
   - Solves the empty-table problem: public waiting rooms automatically begin backfilling after 3.5s – 5.0s with staggered human-like join delays (800ms, 1800ms, 2900ms).
   - Automatic timer cancellation when real human players join.
4. **Anti-Detection & Disguise System**:
   - 45 authentic synthetic player profiles with realistic Middle Eastern & international names, customized avatars, realistic levels (8–48), coin counts, and win/loss records.
   - Zero client leakage: `isBot: false` is permanently sent to client devices.
   - Human jitter & latency simulation (1.2s to 4.5s delay before plays).
   - Disconnect handover: dropped players are covered by a bot after a 30s grace window.
5. **Real-Time WebSocket Additions & Updates**:
   - New `one_card_announcement` broadcast event when 1 card remains in Trix shedding.
   - Enriched `player_joined` and `game_state` payloads with opponent profile statistics.
6. **Production Server Architecture Fixes**:
   - Resolved ESM circular reference Temporal Dead Zone (TDZ) via event decoupling and type-only imports.
   - Fixed Node ESM execution path in `package.json` (`node dist/main.js`).

---

## 1. REST API Endpoints (URLs, Payloads & Outputs)

### Base URLs
- **Local Development:** `http://localhost:3000`
- **Production Server:** `http://157.230.239.31:3000` (or configured domain)

---

### 1.1 `POST /auth/register`
Creates a new user account with default user settings and game statistics in an atomic database transaction.

- **URL:** `/auth/register`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`

#### Request Body Options:

**Option A: Unified Identifier (Mobile App Input)**
```json
{
  "identifier": "+966501234567",
  "password": "Password123!",
  "displayName": "TrixMaster"
}
```
*(Or pass an email: `{"identifier": "player1@trix.com", "password": "Password123!"}`)*

**Option B: Explicit Phone Number**
```json
{
  "phoneNumber": "+966 50 123 4567",
  "password": "Password123!"
}
```

**Option C: Standard Email Registration**
```json
{
  "email": "player1@trix.com",
  "password": "Password123!",
  "displayName": "TrixMaster",
  "avatarUrl": "https://cdn.trixi.com/avatars/1.png"
}
```

#### Response Output (201 Created):
```json
{
  "user": {
    "id": "e6f47738-f1c5-4ad9-bf95-5cb97dca0e5b",
    "email": "player1@trix.com",
    "phoneNumber": "+966501234567",
    "phoneVerified": false,
    "emailVerified": false,
    "displayName": "TrixMaster",
    "avatarUrl": "https://cdn.trixi.com/avatars/1.png",
    "level": 1,
    "xp": 0,
    "coins": 1000,
    "isVip": false,
    "createdAt": "2026-10-26T22:00:00.000Z",
    "updatedAt": "2026-10-26T22:00:00.000Z"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  }
}
```

---

### 1.2 `POST /auth/login`
Authenticates a user via Email OR Mobile Phone.

- **URL:** `/auth/login`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`

#### Request Body:
```json
{
  "identifier": "+966501234567",
  "password": "Password123!"
}
```
*(or `{"email": "player1@trix.com", "password": "Password123!"}`)*

#### Response Output (200 OK):
```json
{
  "user": {
    "id": "e6f47738-f1c5-4ad9-bf95-5cb97dca0e5b",
    "email": "player1@trix.com",
    "phoneNumber": "+966501234567",
    "displayName": "TrixMaster",
    "avatarUrl": "https://cdn.trixi.com/avatars/1.png",
    "level": 1,
    "xp": 0,
    "coins": 1000,
    "isVip": false
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1Ni...",
    "refreshToken": "eyJhbGciOiJIUzI1Ni...",
    "expiresIn": 3600
  }
}
```

---

### 1.3 `POST /auth/refresh`
Rotates the refresh token and issues a new access token.

- **URL:** `/auth/refresh`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`

#### Request Body:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Response Output (200 OK):
```json
{
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1Ni...",
    "refreshToken": "eyJhbGciOiJIUzI1Ni...",
    "expiresIn": 3600
  }
}
```

---

### 1.4 `POST /auth/logout`
Revokes active user session: blacklists access token in Redis and removes refresh token from PostgreSQL.

- **URL:** `/auth/logout`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <accessToken>`

#### Response Output (200 OK):
```json
{
  "message": "Successfully logged out"
}
```

---

### 1.5 `GET /users/me`
Retrieves authenticated player profile, stats, and in-game preferences.

- **URL:** `/users/me`
- **Method:** `GET`
- **Headers:** `Authorization: Bearer <accessToken>`

#### Response Output (200 OK):
```json
{
  "id": "e6f47738-f1c5-4ad9-bf95-5cb97dca0e5b",
  "email": "player1@trix.com",
  "phoneNumber": "+966501234567",
  "phoneVerified": false,
  "emailVerified": true,
  "displayName": "TrixMaster",
  "avatarUrl": "https://cdn.trixi.com/avatars/1.png",
  "level": 3,
  "xp": 350,
  "coins": 1240,
  "isVip": false,
  "settings": {
    "appTheme": "DARK",
    "cardTheme": "CLASSIC",
    "tableTheme": "GREEN_FELT",
    "soundEnabled": true,
    "musicEnabled": true,
    "vibrationEnabled": true,
    "chatEnabled": true
  },
  "stats": {
    "gamesPlayed": 12,
    "wins": 9,
    "losses": 3,
    "soloWins": 5,
    "teamWins": 4,
    "totalQueensCaptured": 6,
    "totalHeartsCaptured": 2,
    "trixFirstPlaceCount": 4
  }
}
```

---

### 1.6 `PATCH /users/profile`
Updates player display name and avatar image.

- **URL:** `/users/profile`
- **Method:** `PATCH`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Request Body:**
```json
{
  "displayName": "EliteTrixPro",
  "avatarUrl": "https://cdn.trixi.com/avatars/custom_05.png"
}
```
- **Response Output (200 OK):** Updated user object.

---

### 1.7 `GET /health`
System health check probing PostgreSQL database, Redis instance, memory metrics, and active rooms.

- **URL:** `/health`
- **Method:** `GET`

#### Response Output (200 OK):
```json
{
  "status": "ok",
  "postgres": "connected",
  "redis": "connected",
  "activeRooms": 2,
  "uptimeSeconds": 3600,
  "memory": {
    "heapUsedMB": "38.45",
    "heapTotalMB": "46.20",
    "rssMB": "89.10"
  },
  "timestamp": "2026-10-27T02:40:00.000Z"
}
```

---

## 2. Real-Time WebSocket API (Socket.IO)

- **WebSocket URL:** `ws://157.230.239.31:3000` (or `ws://localhost:3000`)
- **Transport:** WebSocket
- **Authentication Handshake:**
```javascript
const socket = io('http://157.230.239.31:3000', {
  auth: { token: '<accessToken>' },
  transports: ['websocket']
});
```

---

### 2.1 Client-to-Server Events

#### 1. `create_room`
Creates a room and automatically schedules a bot backfill (3.5s–5.0s) if the room is public.
- **Payload:**
```json
{
  "name": "Championship Table",
  "gameMode": "SOLO",
  "kingdomType": "FREE_MERCY",
  "turnTime": 20,
  "isPrivate": false
}
```
- **Acknowledgment Callback Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "roomCode": "J2KVA6",
  "seat": 0
}
```

#### 2. `join_room`
Joins an open room by 6-character room code or room UUID.
- **Payload:**
```json
{
  "roomIdOrCode": "J2KVA6"
}
```
- **Acknowledgment Callback Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "roomCode": "J2KVA6",
  "seat": 1
}
```

#### 3. `select_contract`
Sent by the kingdom owner (human or bot) during `KINGDOM_SELECTION`.
- **Payload:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "contracts": ["QUEENS"]
}
```
*(In Crazy Complex, multiple contracts can be selected simultaneously, e.g. `["QUEENS", "DIAMONDS"]`)*

#### 4. `declare_double`
Sent during the 8-second `DOUBLING_PHASE` if holding a Queen or King of Hearts.
- **Payload:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "card": { "suit": "HEARTS", "rank": "K", "power": 13 }
}
```

#### 5. `play_card`
Plays a card to the trick (`TRICK_PLAY`) or Trix ladder (`TRIX_PLAY`).
- **Payload:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "card": { "suit": "HEARTS", "rank": "10", "power": 10 }
}
```

#### 6. `pass_trix`
Passes turn in Trix shedding (only permitted when no valid legal card can be placed).
- **Payload:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1"
}
```

---

### 2.2 Server-to-Client Broadcast Events

#### 1. `player_joined`
Broadcasted to all occupants when a player or disguised bot enters an open seat.
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "seat": 1,
  "user": {
    "id": "b0700001-0001-4000-8000-000000000001",
    "displayName": "Tariq Al-Mansoor",
    "avatarUrl": "https://cdn.trixi.com/avatars/avatar_01.png",
    "level": 18,
    "coins": 8450,
    "stats": {
      "gamesPlayed": 240,
      "wins": 144,
      "losses": 96,
      "soloWins": 86,
      "teamWins": 58,
      "winRate": 60.0
    }
  }
}
```

#### 2. `match_started`
Broadcasted immediately when all 4 seats are occupied (via humans or auto-fill bots).
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "gameMode": "SOLO",
  "kingdomType": "FREE_MERCY"
}
```

#### 3. `game_state` (Anti-Cheat Filtered State)
Unicast to each individual player with private hand and opponents' masked status.
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "gamePhase": "TRICK_PLAY",
  "kingdomIndex": 0,
  "kingdomOwnerSeat": 0,
  "currentTurnSeat": 1,
  "activeContracts": ["QUEENS"],
  "kingdomType": "FREE_MERCY",
  "gameMode": "SOLO",
  "turnTimeLimit": 20,
  "mySeat": 0,
  "myHand": [
    { "id": "card-0", "suit": "HEARTS", "rank": "A", "power": 14 },
    { "id": "card-1", "suit": "SPADES", "rank": "10", "power": 10 }
  ],
  "opponents": [
    {
      "seat": 1,
      "remainingCardCount": 13,
      "isConnected": true,
      "isDoublingAnnounced": false,
      "isBot": false,
      "displayName": "Tariq Al-Mansoor",
      "avatarUrl": "https://cdn.trixi.com/avatars/avatar_01.png",
      "level": 18,
      "coins": 8450,
      "stats": { "gamesPlayed": 240, "wins": 144, "losses": 96, "winRate": 60.0 }
    },
    {
      "seat": 2,
      "remainingCardCount": 13,
      "isConnected": true,
      "isDoublingAnnounced": false,
      "isBot": false,
      "displayName": "Zaid Qasim",
      "avatarUrl": "https://cdn.trixi.com/avatars/avatar_02.png",
      "level": 12,
      "coins": 4320,
      "stats": { "gamesPlayed": 110, "wins": 58, "losses": 52, "winRate": 52.7 }
    },
    {
      "seat": 3,
      "remainingCardCount": 13,
      "isConnected": true,
      "isDoublingAnnounced": false,
      "isBot": false,
      "displayName": "Layla Al-Hashimi",
      "avatarUrl": "https://cdn.trixi.com/avatars/avatar_03.png",
      "level": 21,
      "coins": 13800,
      "stats": { "gamesPlayed": 360, "wins": 220, "losses": 140, "winRate": 61.1 }
    }
  ],
  "currentTrick": [],
  "scores": {
    "totalScores": { "0": 0, "1": 0, "2": 0, "3": 0 },
    "roundScores": []
  }
}
```

#### 4. `timer_tick`
Emitted every 1000ms during turn action countdowns.
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "remainingSeconds": 14,
  "phase": "TURN",
  "seat": 1
}
```

#### 5. `card_doubled`
Broadcasted when an eligible player or bot doubles a Queen or King of Hearts.
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "seat": 2,
  "card": { "id": "card-qh", "suit": "HEARTS", "rank": "Q", "power": 12, "isDoubled": true }
}
```

#### 6. `trick_completed`
Broadcasted when 4 cards have been played to a trick.
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "winnerSeat": 3,
  "completedTrick": {
    "leadSuit": "DIAMONDS",
    "cards": [
      { "seat": 1, "card": { "suit": "DIAMONDS", "rank": "9", "power": 9 } },
      { "seat": 2, "card": { "suit": "DIAMONDS", "rank": "10", "power": 10 } },
      { "seat": 3, "card": { "suit": "DIAMONDS", "rank": "A", "power": 14 } },
      { "seat": 0, "card": { "suit": "DIAMONDS", "rank": "5", "power": 5 } }
    ],
    "winnerSeat": 3
  }
}
```

#### 7. `one_card_announcement` (NEW)
Broadcasted in Trix mode when a player or bot has only 1 card remaining in hand.
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "seat": 2,
  "displayName": "Zaid Qasim",
  "remainingCards": 1
}
```

#### 8. `contract_ended`
Broadcasted when a contract completes (after 13 tricks or all cards shed in Trix).
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "roundScores": { "0": -25, "1": -50, "2": 0, "3": -25 },
  "totalScores": { "0": -25, "1": -50, "2": 0, "3": -25 },
  "nextPhase": "KINGDOM_SELECTION"
}
```

#### 9. `game_over`
Broadcasted when all 4 kingdoms (20 contracts total) are completed.
- **Payload Output:**
```json
{
  "roomId": "841210c9-7bd8-4546-82b7-d6809b4f04d1",
  "finalScores": { "0": 175, "1": -80, "2": 35, "3": -130 }
}
```

---

## 3. Bot Architecture & Anti-Detection Specification

| Feature | Specification | Implementation Detail |
| :--- | :--- | :--- |
| **Bot Persona Pool** | 45 Unique Personas | Realistic Arabic and international names, levels 8–48, coin counts 2,500–25,000, realistic win rates 48%–65%. |
| **Client Disguise** | Anti-Detection Shield | `isBot` is serialized as `false`. Opponent cards in hand are hidden. |
| **Auto-Fill Window** | 3.5s – 5.0s Delay | Timer triggers when a public room is created. If fewer than 4 players, bots join staggered. |
| **Staggered Joins** | +800ms, +1800ms, +2900ms | Bots enter seats one-by-one to mimic organic human matchmaking. |
| **Turn Simulation Latency**| 1.2s – 4.5s Delay | Bots do not play instantly (0ms); human reaction delays are calculated with random jitter. |
| **Disconnect Handover** | 30s Grace Timer | Disconnected human players have 30s to reconnect. If expired, bot brain seamlessly plays for them. |
| **One-Card Shout** | Automatic Announcement | In Trix mode, bots announce "One Card!" after playing their penultimate card. |

---

## 4. Summary of Modified Codebase Files

- `src/bot/bot-persona.data.ts`: 45 persona configurations with helper `getRandomBotPersonas()`.
- `src/bot/bot-brain.service.ts`: Core AI heuristics for contract selection, doubling, trick plays, and Trix plays.
- `src/bot/bot-fill.service.ts`: Matchmaking room backfill timer with staggered seat allocations.
- `src/bot/bot-action.service.ts`: Latency simulation, 30s disconnect handover, and Trix one-card shouts.
- `src/bot/bot.module.ts`: Exported NestJS Bot module.
- `src/game-room/services/game-room.service.ts`: Decoupled room lifecycle callbacks (`onRoomCreated`, `onRoomDestroyed`).
- `src/game-room/game.gateway.ts`: Delegated execution methods for automated bot plays and masked event broadcasts.
- `src/game-room/serializers/player-view.serializer.ts`: Masked anti-cheat player views with `isBot: false`.
- `src/auth/`: Dual-identifier authentication with email or mobile phone support.
- `package.json`: Fixed `"start:prod": "node dist/main.js"`.
