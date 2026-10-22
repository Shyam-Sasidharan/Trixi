# TRIXI Backend: API & Real-Time Events Reference

This document provides the complete API reference for all REST HTTP endpoints and real-time Socket.IO WebSocket contracts implemented in the **TRIXI** backend.

---

## 1. REST API Specification

### Base URL
- Local: `http://localhost:3000`
- Production: `https://api.trixi.yourdomain.com`

---

### 1.1 Authentication & Session (`/auth`)

#### `POST /auth/register`
Creates a new player account with default `UserSettings` and `UserStats` inside an atomic transaction.
- **Headers**: `Content-Type: application/json`
- **Body**:
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
      "displayName": "TrixMaster",
      "avatarUrl": "https://cdn.trixi.com/avatars/1.png",
      "level": 1,
      "xp": 0,
      "coins": 1000,
      "isVip": false
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1Ni...",
      "refreshToken": "eyJhbGciOiJIUzI1Ni..."
    }
  }
  ```

#### `POST /auth/login`
Validates credentials and returns JWT token pair.
- **Body**: `{ "email": "player1@trix.com", "password": "Password123!" }`
- **Response (200 OK)**: Returns user profile and token pair.

#### `POST /auth/refresh`
Rotates refresh tokens and issues fresh access token.
- **Body**: `{ "refreshToken": "eyJhbGciOiJIUzI1Ni..." }`
- **Response (200 OK)**: `{ "accessToken": "...", "refreshToken": "..." }`

#### `POST /auth/logout`
Revokes active session from Redis and PostgreSQL.
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
    { "seat": 1, "remainingCardCount": 13, "isConnected": true, "isDoublingAnnounced": false },
    { "seat": 2, "remainingCardCount": 13, "isConnected": true, "isDoublingAnnounced": false },
    { "seat": 3, "remainingCardCount": 13, "isConnected": true, "isDoublingAnnounced": false }
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
