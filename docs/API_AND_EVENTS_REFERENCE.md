# TRIXI Backend: API & Real-Time Events Reference

This document provides the complete API reference for all REST HTTP endpoints and real-time Socket.IO WebSocket contracts implemented in the **TRIXI** backend.

---

## 1. REST API Specification

### Base URL
- Local: `http://localhost:3000`
- Production: `https://api.trixi.yourdomain.com`

---

### 1.1 Authentication & Session (`/auth`)

Supports dual-identifier authentication: players can register and log in using either an **Email Address** OR a **Mobile Phone Number** (or a single unified `identifier` matching the Flutter/mobile UI's "Email or phone" input).

#### `POST /auth/register`
Creates a new player account with default `UserSettings` and `UserStats` inside an atomic transaction. At least one identifier (`identifier`, `email`, or `phoneNumber`) must be provided.

- **Headers**: `Content-Type: application/json`
- **Request Body Options**:

  *Option A: Unified Identifier (Recommended for Flutter/Mobile UI)*
  ```json
  {
    "identifier": "+966501234567",
    "password": "Password123!",
    "displayName": "TrixMaster"
  }
  ```
  *(or pass an email into `identifier`: `{"identifier": "player1@trix.com", "password": "..."}`)*

  *Option B: Explicit Mobile Phone Number*
  ```json
  {
    "phoneNumber": "+966 50 123 4567",
    "password": "Password123!"
  }
  ```
  *(Note: Phone numbers are automatically normalized; spaces, dashes, and parentheses are stripped, and leading `00` converts to `+`. If `displayName` is omitted, it auto-defaults to `Player_<last4Digits>` e.g., `Player_4567`)*

  *Option C: Legacy Email Registration (100% Backward Compatible)*
  ```json
  {
    "email": "player1@trix.com",
    "password": "Password123!",
    "displayName": "TrixMaster",
    "avatarUrl": "https://cdn.trixi.com/avatars/1.png"
  }
  ```

- **Response (201 Created)**:
  ```json
  {
    "user": {
      "id": "e6f47738-f1c5-4ad9-bf95-5cb97dca0e5b",
      "email": "player1@trix.com",
      "phoneNumber": null,
      "phoneVerified": false,
      "emailVerified": false,
      "displayName": "TrixMaster",
      "avatarUrl": "https://cdn.trixi.com/avatars/1.png",
      "level": 1,
      "xp": 0,
      "coins": 1000,
      "isVip": false,
      "createdAt": "2026-10-24T17:40:00.000Z",
      "updatedAt": "2026-10-24T17:40:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1Ni...",
      "refreshToken": "eyJhbGciOiJIUzI1Ni...",
      "expiresIn": 3600
    }
  }
  ```

#### `POST /auth/login`
Validates player credentials using either their Email OR Mobile Phone Number.
- **Request Body Options**:
  *Option A: Unified Identifier (Mobile App Input)*
  ```json
  {
    "identifier": "+966501234567",
    "password": "Password123!"
  }
  ```
  *Option B: Legacy Format*
  ```json
  {
    "email": "player1@trix.com",
    "password": "Password123!"
  }
  ```
- **Response (200 OK)**: Returns the sanitized user profile and token pair.

#### `POST /auth/refresh`
Rotates refresh tokens, deletes the used token record from the database, and issues fresh tokens. Refreshed token claims automatically include `phoneNumber` and `displayName`.
- **Body**: `{ "refreshToken": "eyJhbGciOiJIUzI1Ni..." }`
- **Response (200 OK)**:
  ```json
  {
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1Ni...",
      "refreshToken": "eyJhbGciOiJIUzI1Ni...",
      "expiresIn": 3600
    }
  }
  ```

#### `POST /auth/logout`
Revokes active session: blacklists the access token in Redis (until its JWT expiration) and purges refresh tokens from PostgreSQL.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response (200 OK)**: `{ "message": "Successfully logged out" }`

---

### 1.2 User Profile & Settings (`/users`)

#### `GET /users/me`
Retrieves authenticated player profile, stats, and personalized settings.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response (200 OK)**:
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

#### `PATCH /users/profile`
Updates player display name or avatar.
- **Body**: `{ "displayName": "NewName", "avatarUrl": "https://..." }`

#### `PATCH /users/settings`
Updates client customization preferences.
- **Body**: `{ "cardTheme": "LUXURY", "tableTheme": "ROYAL_BLUE" }`

---

### 1.3 Leaderboards (`/leaderboard`)

#### `GET /leaderboard/global?limit=100`
Returns top 100 global players ranked by wins and win-rate percentage. Cached in Redis (3m TTL).
- **Response (200 OK)**:
  ```json
  [
    {
      "rank": 1,
      "userId": "e6f47738-f1c5-4ad9-bf95-5cb97dca0e5b",
      "displayName": "TopDog",
      "avatarUrl": null,
      "level": 14,
      "xp": 7200,
      "coins": 3500,
      "isVip": true,
      "gamesPlayed": 80,
      "wins": 68,
      "losses": 12,
      "winRate": 85.0
    }
  ]
  ```

#### `GET /leaderboard/friends`
Returns rankings localized around the authenticated player's neighborhood.
- **Headers**: `Authorization: Bearer <accessToken>`

---

### 1.4 System Health & Observability (`/health`)

#### `GET /health`
Probes database, Redis, process memory, and active room counts.
- **Response (200 OK)**:
  ```json
  {
    "status": "ok",
    "postgres": "connected",
    "redis": "connected",
    "activeRooms": 4,
    "uptimeSeconds": 1420,
    "memory": {
      "heapUsedMB": "42.10",
      "heapTotalMB": "48.50",
      "rssMB": "94.20"
    },
    "timestamp": "2026-10-22T10:15:30.000Z"
  }
  ```
- **Failure (503 Service Unavailable)**: Returned if PostgreSQL connectivity is lost.

---

## 2. Real-Time Socket.IO WebSocket Specification

### Connection & Handshake
- **URL**: `ws://localhost:3000` or `wss://api.trixi.yourdomain.com`
- **Path**: `/socket.io/`
- **Handshake Auth**:
  ```javascript
  const socket = io('https://api.trixi.yourdomain.com', {
    auth: {
      token: '<accessToken>'
    },
    transports: ['websocket']
  });
  ```

---

### 2.1 Client -> Server Events

| Event Name | Payload | Description |
| :--- | :--- | :--- |
| `create_room` | `{ name?: string, password?: string, gameMode?: 'SOLO'\|'TEAM', kingdomType?: 'FREE_MERCY'\|'CRAZY_COMPLEX', turnTime?: 10\|20\|30, isPrivate?: boolean }` | Creates a new room. Host is seated at Seat 0. Returns `{ roomId, roomCode, seat: 0 }`. |
| `join_room` | `{ roomIdOrCode: string, password?: string }` | Joins an active room by UUID or 6-char room code. When 4 players are seated, match starts automatically. |
| `reconnect_game`| `{}` | Reconnects dropped player back to their seated game session. |
| `select_contract` | `{ roomId: string, contracts: ContractType[] }` | Sent by Kingdom Owner to pick contract(s) (`QUEENS`, `KING_OF_HEARTS`, `DIAMONDS`, `HANDS`, `TRIX`). |
| `declare_double` | `{ roomId: string, card: Card }` | Sent during `DOUBLING_PHASE` to expose a doubled Queen or K♥. |
| `play_card` | `{ roomId: string, card: Card }` | Plays card to the current trick (`TRICK_PLAY`) or ladder column (`TRIX_PLAY`). |
| `pass_trix` | `{ roomId: string }` | Passes turn in Trix shedding (strictly validated: rejected if playable card exists). |

---

### 2.2 Server -> Client Events

#### `game_state` (Anti-Cheat Masked Table Update)
Emitted to individual player socket channels. Contains strictly recipient's hand and opponents' remaining card counts:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "gamePhase": "TRICK_PLAY",
  "kingdomIndex": 1,
  "kingdomOwnerSeat": 2,
  "currentTurnSeat": 2,
  "activeContracts": ["HANDS"],
  "kingdomType": "FREE_MERCY",
  "gameMode": "SOLO",
  "turnTimeLimit": 10,
  "mySeat": 0,
  "myHand": [
    { "id": "card-0", "suit": "HEARTS", "rank": "A", "power": 14 },
    { "id": "card-1", "suit": "HEARTS", "rank": "10", "power": 10 },
    { "id": "card-2", "suit": "DIAMONDS", "rank": "Q", "power": 12 }
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
      "stats": { "gamesPlayed": 240, "wins": 144, "losses": 96, "soloWins": 86, "teamWins": 58, "winRate": 60.0 }
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
      "stats": { "gamesPlayed": 110, "wins": 58, "losses": 52, "soloWins": 32, "teamWins": 26, "winRate": 52.7 }
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
      "stats": { "gamesPlayed": 360, "wins": 220, "losses": 140, "soloWins": 130, "teamWins": 90, "winRate": 61.1 }
    }
  ],
  "doubledCardsOnTable": [],
  "currentTrick": [],
  "trixColumns": { ... },
  "scores": {
    "totalScores": { "0": 0, "1": 0, "2": 0, "3": 0 },
    "roundScores": []
  },
  "lastTrickWinner": null,
  "isDoublingPhase": false,
  "canDoubleCards": []
}
```

#### `player_joined`
Broadcasted to the room channel when a new player or disguised bot joins an open seat:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
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

#### `match_started`
Broadcasted when all 4 seats are occupied and the match begins:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "gameMode": "SOLO",
  "kingdomType": "FREE_MERCY"
}
```

#### `timer_tick`
Broadcasted every 1 second during active countdowns:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "remainingSeconds": 7,
  "phase": "TURN",
  "seat": 2
}
```

#### `doubling_phase_started`
Broadcasted when contracts containing Queens or King of Hearts begin:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "durationSeconds": 8,
  "activeContracts": ["QUEENS"]
}
```

#### `card_doubled`
Broadcasted when an eligible player exposes a doubled card:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "seat": 1,
  "card": { "id": "c-q-hearts", "suit": "HEARTS", "rank": "Q", "power": 12, "isDoubled": true }
}
```

#### `trick_completed`
Broadcasted when 4 cards are played to a trick:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "winnerSeat": 3,
  "completedTrick": {
    "leadSuit": "DIAMONDS",
    "cards": [
      { "seat": 2, "card": { "suit": "DIAMONDS", "rank": "K", "power": 13 } },
      { "seat": 1, "card": { "suit": "DIAMONDS", "rank": "10", "power": 10 } },
      { "seat": 0, "card": { "suit": "DIAMONDS", "rank": "Q", "power": 12 } },
      { "seat": 3, "card": { "suit": "DIAMONDS", "rank": "A", "power": 14 } }
    ],
    "winnerSeat": 3
  }
}
```

#### `auto_played` / `auto_passed`
Broadcasted if a player's turn timer times out or a disconnected bot makes a move:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "seat": 2,
  "card": { "suit": "CLUBS", "rank": "4", "power": 4 },
  "phase": "TRICK_PLAY"
}
```

#### `one_card_announcement`
Broadcasted in `TRIX_PLAY` when a player's or bot's remaining hand count drops to exactly 1:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "seat": 2,
  "displayName": "Zaid Qasim",
  "remainingCards": 1
}
```

#### `contract_ended`
Broadcasted upon completion of 13 tricks or full Trix shedding:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "roundScores": { "0": -30, "1": -45, "2": -60, "3": -60 },
  "totalScores": { "0": -30, "1": -45, "2": -60, "3": -60 },
  "nextPhase": "KINGDOM_SELECTION"
}
```

#### `game_over`
Broadcasted upon match completion after 20 rounds:
```json
{
  "roomId": "f7206404-f961-46ca-9909-4e6f3f41da6f",
  "finalScores": { "0": 210, "1": -95, "2": -40, "3": -75 }
}
```
