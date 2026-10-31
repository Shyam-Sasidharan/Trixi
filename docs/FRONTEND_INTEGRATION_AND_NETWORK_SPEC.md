# TRIXI Multiplayer — Frontend Developer Integration & Network Specification

**Target Audience:** Flutter (iOS / Android) Client Engineers & UI/UX Developers  
**Backend Framework:** NestJS / Socket.IO / TypeScript (ESM)  
**Document Status:** Production Ready (Verified against Backend v2.1.0)  
**Date:** October 31, 2026  

---

## 1. Executive Summary of Backend Architecture Upgrades

The backend has undergone major multiplayer stabilization and real-time execution remediation:

1. **Resolution of Bot Turn Freeze & Execution Hangs:**
   - Previous behavior: When turn passed to an AI bot, the game would occasionally freeze, and the bot would neither play nor take actions until the 20-second room timer ran out.
   - Resolution: Replaced fragile global timer cancellations with scoped action keys (`${roomId}:${phase}:${seat}:${turnId}`). Bot turns and human turns now share the exact same authoritative validation, trick resolution, score accounting, and state broadcasting pipelines.
2. **Unified Move Pipeline (`executePlayCard`):**
   - Whether a card is played by a human tap (`play_card`), an autonomous bot decision, or a 20-second timeout auto-play, it flows through the exact same server validation engine.
3. **Flutter "Invalid Card" Fix Alignment:**
   - The backend strictly enforces card legality. Client UI must disable card taps during non-card-play phases (`KINGDOM_SELECTION` and `DOUBLING_PHASE`).
4. **Zero-Trust Anti-Cheat & Bot Disguise System:**
   - Bots appear 100% identical to real human players. The backend emits `isBot: false` to all clients, accompanied by authentic display names, realistic avatars, levels (8–48), coin counts, and win/loss statistics.
   - Opponents' hands are completely stripped from `game_state` payloads.
5. **Monotonic Event Sequencing (`roomSequence`):**
   - Every single outbound event now carries a strictly increasing integer `roomSequence`. This enables the client to detect and reject out-of-order network packets.
6. **Authoritative Clock Synchronization (`deadlineAt`, `serverTime`):**
   - Every timer tick and state update provides Unix epoch millisecond timestamps (`serverTime`, `deadlineAt`) so Flutter can render smooth client-side countdowns without drifting.

---

## 2. Real-Time Socket Connection & Auth Handshake

### 2.1 Connection Details
- **Protocol:** Socket.IO v4 Client
- **Transports:** `['websocket', 'polling']` (WebSocket preferred, polling fallback supported)
- **Base URL:**
  - Local Dev: `http://localhost:3000`
  - Production: `http://157.230.239.31:3000` (or configured API domain)
- **Authentication:** Pass the JWT access token in the connection `auth` dictionary or handshake headers.

```dart
// Flutter Socket.IO Client Configuration Example
IO.Socket socket = IO.io(
  'http://157.230.239.31:3000',
  IO.OptionBuilder()
    .setTransports(['websocket', 'polling'])
    .enableAutoConnect()
    .enableReconnection()
    .setAuth({'token': userAccessToken}) // or Bearer token
    .build(),
);
```

---

## 3. Client State Synchronization Rules

### 3.1 Monotonic Sequencing (`roomSequence` & `stateVersion`)
To prevent out-of-order packet processing (e.g. over cellular 4G/5G):
- The client must maintain `int lastSeenRoomSequence = 0;`
- Whenever an event is received, check:
  ```dart
  if (data.containsKey('roomSequence')) {
    final int incomingSeq = data['roomSequence'];
    if (incomingSeq <= lastSeenRoomSequence) {
      // Out-of-order or duplicate packet: ignore payload
      return;
    }
    lastSeenRoomSequence = incomingSeq;
  }
  ```

### 3.2 Authoritative Clock Sync (`deadlineAt` & `serverTime`)
Do not rely purely on local device timers:
1. When receiving `game_state`, `timer_tick`, or `doubling_phase_started`:
   - Calculate client clock offset: `clockOffset = DateTime.now().millisecondsSinceEpoch - data['serverTime'];`
   - Calculate target deadline: `deadline = data['deadlineAt'] ?? data['deadlineTimestamp'];`
2. Remaining seconds for UI circular bar:
   ```dart
   final nowAdjusted = DateTime.now().millisecondsSinceEpoch - clockOffset;
   final remainingSeconds = ((deadline - nowAdjusted) / 1000).ceil().clamp(0, 30);
   ```

### 3.3 Idempotency via `actionId`
When sending actions (`play_card`, `select_contract`, `declare_double`, `pass_trix`), always include a unique client-generated UUID in `actionId`:
```json
{
  "roomId": "018b3ea7-370b-4bba-9b64-0af039135342",
  "card": { "id": "HEARTS_K", "suit": "HEARTS", "rank": "K", "power": 13 },
  "actionId": "c3d4f5a6-7b8c-9d0e-1f2a-3b4c5d6e7f8a"
}
```
If network turbulence causes a retry of the same `actionId`, the backend safely returns `{ "success": true, "duplicate": true }` without penalizing the player.

---

## 4. Inbound Events (Client -> Server)

| Event Name | Description | Key Payload Parameters |
|---|---|---|
| `quick_play` | Automated matchmaking entry. Joins an open table or auto-creates one. | `{ gameMode?: 'SOLO' \| 'TEAM', kingdomType?: 'FREE_MERCY' \| 'CRAZY_COMPLEX', allowBots?: boolean }` |
| `join_queue` | Enqueues player in matchmaking pool. | `{ gameMode?: 'SOLO' \| 'TEAM', kingdomType?: 'FREE_MERCY' \| 'CRAZY_COMPLEX' }` |
| `leave_queue` | Cancels matchmaking queue. | `{}` |
| `create_room` | Creates a custom private or public lobby. | `{ name: string, gameMode: 'SOLO' \| 'TEAM', kingdomType: 'FREE_MERCY' \| 'CRAZY_COMPLEX', turnTime: 10 \| 20 \| 30, isPrivate: boolean, password?: string, allowBots: boolean }` |
| `join_room` | Joins a room by 6-char `roomCode` or UUID `roomId`. | `{ roomIdOrCode: string, password?: string }` |
| `reconnect_game` | Re-establishes state after app backgrounding or drop. | `{ roomId: string }` |
| `select_contract` | Kingdom Owner selects 1 contract (Free Mercy) or 4/5 (Crazy Complex). | `{ roomId: string, contracts: ContractType[], actionId?: string }` |
| `declare_double` | Declares doubling for a Queen or King of Hearts during `DOUBLING_PHASE`. | `{ roomId: string, card: Card, actionId?: string }` |
| `play_card` | Plays a card to the trick or Trix layout. | `{ roomId: string, card: Card, actionId?: string, clientVersion?: number, turnId?: number }` |
| `pass_trix` | Passes turn during `TRIX_PLAY` if no legal cards can be played. | `{ roomId: string, actionId?: string, clientVersion?: number, turnId?: number }` |

---

## 5. Outbound Events (Server -> Client)

### 5.1 `match_started`
Fired to the entire room as soon as all 4 seats are occupied.
```json
{
  "roomId": "e86639b4-3bc6-4af2-8f0e-6ada521d7531",
  "roomSequence": 5,
  "gameMode": "SOLO",
  "kingdomType": "FREE_MERCY",
  "activeKingdom": {
    "kingdomIndex": 0,
    "ownerSeat": 0,
    "consumedContracts": []
  }
}
```

### 5.2 `game_state`
The core authoritative state broadcast sent to individual players (private, sanitized view).
```json
{
  "roomId": "e86639b4-3bc6-4af2-8f0e-6ada521d7531",
  "roomSequence": 6,
  "stateVersion": 2,
  "turnId": 2,
  "serverTime": 1793454486902,
  "deadlineAt": 1793454506902,
  "currentPhase": "TRICK_PLAY",
  "currentTurnSeat": 1,
  "mySeat": 0,
  "myHand": [
    { "id": "HEARTS_2", "suit": "HEARTS", "rank": 2, "power": 2, "isDoubled": false },
    { "id": "CLUBS_A", "suit": "CLUBS", "rank": "A", "power": 14, "isDoubled": false }
  ],
  "handCounts": { "0": 13, "1": 12, "2": 13, "3": 13 },
  "activeContracts": ["HANDS"],
  "currentTrick": {
    "leadSuit": "HEARTS",
    "cards": [
      {
        "seat": 1,
        "card": { "id": "HEARTS_K", "suit": "HEARTS", "rank": "K", "power": 13, "isDoubled": false }
      }
    ]
  },
  "trixColumns": {
    "HEARTS": { "isOpen": false, "highPower": 11, "lowPower": 11, "cards": [] },
    "DIAMONDS": { "isOpen": false, "highPower": 11, "lowPower": 11, "cards": [] },
    "CLUBS": { "isOpen": false, "highPower": 11, "lowPower": 11, "cards": [] },
    "SPADES": { "isOpen": false, "highPower": 11, "lowPower": 11, "cards": [] }
  },
  "scores": { "0": 0, "1": 0, "2": 0, "3": 0 },
  "seatsInfo": {
    "0": { "seat": 0, "displayName": "HostPlayer", "isBot": false, "isConnected": true },
    "1": { "seat": 1, "displayName": "Tariq Al-Mansour", "isBot": false, "isConnected": true },
    "2": { "seat": 2, "displayName": "Zaid Al-Harbi", "isBot": false, "isConnected": true },
    "3": { "seat": 3, "displayName": "Layla Abboud", "isBot": false, "isConnected": true }
  }
}
```

### 5.3 `timer_tick`
Emitted every 1000ms during active turns and doubling phase.
```json
{
  "roomId": "e86639b4-3bc6-4af2-8f0e-6ada521d7531",
  "remainingSeconds": 14,
  "phase": "TURN",
  "seat": 1,
  "turnId": 2,
  "stateVersion": 2,
  "roomSequence": 7,
  "serverTime": 1793454492902,
  "deadlineAt": 1793454506902
}
```

### 5.4 `card_doubled`
Broadcast when any player declares a double on Queen or King of Hearts.
```json
{
  "roomId": "e86639b4-3bc6-4af2-8f0e-6ada521d7531",
  "seat": 2,
  "card": { "id": "HEARTS_Q", "suit": "HEARTS", "rank": "Q", "power": 12 },
  "turnId": 1,
  "stateVersion": 2,
  "roomSequence": 8
}
```

### 5.5 `trick_completed`
Emitted immediately when the 4th card of a trick is played.
- **Critical Frontend Requirement:** The trick cards MUST remain displayed on table for `displayDurationMs` (1500ms).
- Do not clear trick cards on client until the 1500ms has elapsed. The backend automatically clears the trick on server-side and broadcasts the new state at 1500ms.
```json
{
  "roomId": "e86639b4-3bc6-4af2-8f0e-6ada521d7531",
  "trickCards": [
    { "seat": 1, "card": { "id": "HEARTS_2", "suit": "HEARTS", "rank": 2, "power": 2 } },
    { "seat": 2, "card": { "id": "HEARTS_5", "suit": "HEARTS", "rank": 5, "power": 5 } },
    { "seat": 3, "card": { "id": "HEARTS_9", "suit": "HEARTS", "rank": 9, "power": 9 } },
    { "seat": 0, "card": { "id": "HEARTS_A", "suit": "HEARTS", "rank": "A", "power": 14 } }
  ],
  "trickWinnerSeat": 0,
  "winnerSeat": 0,
  "nextTurnSeat": 0,
  "roundScores": { "0": -15, "1": 0, "2": 0, "3": 0 },
  "displayDurationMs": 1500,
  "turnId": 2,
  "stateVersion": 3,
  "roomSequence": 12
}
```

### 5.6 `auto_played` & `auto_passed`
Emitted when a player or bot runs out of time on turn countdown:
- `auto_played`: Lowest legal card was automatically played into trick or trix layout.
- `auto_passed`: Player held no playable cards in Trix and was passed automatically.

```json
{
  "roomId": "e86639b4-3bc6-4af2-8f0e-6ada521d7531",
  "seat": 1,
  "card": { "id": "CLUBS_2", "suit": "CLUBS", "rank": 2, "power": 2 },
  "phase": "TRICK_PLAY",
  "turnId": 4,
  "stateVersion": 5,
  "roomSequence": 16
}
```

### 5.7 `one_card_announcement`
Broadcast during Trix shedding when a player has exactly 1 card remaining in hand.
- Trigger voice line ("Wahed!" / "One Card!") and visual banner.
```json
{
  "roomId": "e86639b4-3bc6-4af2-8f0e-6ada521d7531",
  "seat": 2,
  "displayName": "Zaid Al-Harbi",
  "remainingCards": 1
}
```

### 5.8 `contract_ended` & `game_over`
- `contract_ended`: Emitted after trick 13 or when all cards are placed in Trix. Contains `roundScores` and `totalScores`.
- `game_over`: Emitted when all 4 kingdoms (20 contracts) have concluded. Contains `finalScores`.

---

## 6. Client Development Checklist & Best Practices

1. **Phase Guards for Card Clicks:**
   - Allow card clicks **only** if:
     `currentPhase == 'TRICK_PLAY' || currentPhase == 'TRIX_PLAY'` AND `currentTurnSeat == mySeat`.
   - If player clicks a card during `KINGDOM_SELECTION` or `DOUBLING_PHASE`, client should ignore the tap rather than displaying an "Invalid Card" error.
2. **Trick Clearance Animation:**
   - When `trick_completed` arrives, animate the winning card/player collecting the pile.
   - Wait `1500ms` before clearing the table; the server will send the updated `game_state` with the new empty trick and leader.
3. **Sound & Haptics:**
   - Play audio cues on `card_doubled`, `trick_completed`, `auto_played`, and `one_card_announcement`.
4. **Reconnection Strategy:**
   - On app lifecycle resume (`AppLifecycleState.resumed`) or network reconnection, immediately emit `reconnect_game` with `{ roomId: currentRoomId }` to receive a fresh authoritative `game_state`.

