# TRIXI Backend: Bot AI & Matchmaking Automation Development Report

**Date:** October 26–27, 2026  
**Module:** Game Engine & Real-Time Multiplayer (`src/bot/`, `src/game-room/`)  
**Status:** In Production / Fully Tested (18/18 test suites, 100/100 tests passed)

---

## 1. Executive Summary

During the last development sprint, the TRIXI backend was upgraded with a **Production-Grade Bot AI Engine**, **Matchmaking Room Auto-Backfill Service**, **Human Latency Simulator**, **Anti-Cheat/Anti-Detection Masking**, and **ESM Circular Dependency Decoupling**.

### Key Deliverables:
1. **Realistic Persona Pool**: 45 lifelike Middle Eastern and international player profiles with authentic names, avatar paths, levels (5–65), coins (2.4k–185k), and win rates (44%–62%).
2. **Pure Heuristic Bot Brain**: Intelligent decision algorithms for all Trix contracts (King of Hearts, Queens, Diamonds, Hands/Trex, and Trix), contract selection in Free Mercy & Complex modes, and strategic Doubling evaluations.
3. **Automated Matchmaking Backfill**: 3.5s–5.0s human-waiting threshold followed by staggered bot entry (+800ms, +1800ms, +2900ms) to ensure waiting rooms are never abandoned.
4. **Human Latency & Anti-Detection**:
   - Dynamic turn latency (1.2s–4.5s) preventing instant computerized moves.
   - Zero client leakage: Flutter clients always receive `isBot: false` with authentic profile data.
   - Real-time `one_card_announcement` broadcast when bots or players have 1 card remaining in Trix.
   - 30-second disconnect grace timer with seamless bot takeover.
5. **Node.js ESM Architecture Decoupling**: Completely resolved runtime circular dependency TDZ crashes (`ReferenceError: Cannot access 'GameGateway' before initialization`) and fixed production startup script for native ECMAScript Modules (`"type": "module"`).

---

## 2. Architecture & Component Details

### 2.1 Synthetic Persona Pool (`src/bot/bot-persona.data.ts`)
- **Profile Pool**: 45 unique personas crafted to reflect realistic player demographics (e.g., *Tariq Al-Mansoor*, *Nour Al-Huda*, *Layla Kassam*, *Malak Bishara*, *Zaid Qasim*).
- **Profile Attributes**:
  - `displayName`, `avatarUrl`, `level` (5–65), `xp`, `coins` (2,400 to 185,000).
  - Realistic stats: `gamesPlayed` (24–380), `wins` (11–215), and `winRate` (0.44–0.62).
- **Utility**: `getRandomBotPersonas(count, excludeNames)` provides non-repeating personas for a given match.

### 2.2 Intelligent Bot Brain (`src/bot/bot-brain.service.ts`)
Heuristic-driven decision making without heavy external ML dependencies:
- **Contract Selection**:
  - Scores remaining available contracts based on hand safety (penalty card risk, void suits, high honors).
  - Supports Free Mercy (Kingdom Owner choice) and Crazy Complex modes.
- **Doubling Heuristics**:
  - Evaluates King of Hearts risk (e.g., having K♥ without high heart protection vs. holding Ace of Hearts).
  - Evaluates Queens risk based on suit length and high card holdings.
  - Computes risk/reward ratio before declaring double.
- **Trick Play Engine**:
  - Honors lead suit rules and legal card requirements.
  - Intelligently dumps penalty cards (Q♠, K♥, high Diamonds) on opponents when void of the led suit.
  - Avoids taking tricks that contain penalty cards; ducks underneath when possible.
- **Trix Contract Layout Engine**:
  - Plays opening Jacks when advantageous.
  - Expands existing suit runs upwards (towards King) or downwards (towards Ace/2).
  - Blocks opponents by withholding transitional cards if holding alternative moves.
  - Empties suits strategically to increase discard opportunities.

### 2.3 Automated Backfill Service (`src/bot/bot-fill.service.ts`)
- **Lifecycle Monitoring**: Subscribes to room creation events via decoupled hooks (`onRoomCreated`, `onRoomDestroyed`).
- **Backfill Window**: Schedules a 3.5s to 5.0s timer when a public room is created.
- **Staggered Seating**: Joins bots one by one with realistic staggered intervals (800ms–1100ms apart) rather than filling all seats at index 0ms.
- **Auto-Start**: Automatically triggers game start when the 4th player sits down.
- **Cancellation**: Safely clears timers when real human players join and fill the room, or if the room is closed.

### 2.4 Human Action Simulator & Disconnect Takeover (`src/bot/bot-action.service.ts`)
- **Latency Jitter**: Emulates human reaction and thinking time:
  - Contract Selection: 2,000ms – 4,500ms.
  - Doubling Declarations: 1,500ms – 3,500ms.
  - Card Plays: 1,200ms – 4,000ms.
- **One Card Announcement**:
  - Broadcasts `one_card_announcement` when any player (bot or human) has 1 card remaining in a Trix contract, simulating genuine social gameplay.
- **Disconnect Grace Period Takeover**:
  - When a human disconnects, a 30s countdown is initiated.
  - If reconnect fails, `GameRoomService` marks the seat as bot-controlled without interrupting the other 3 players.
  - `BotActionService` takes over immediately, maintaining game progression.

### 2.5 Anti-Detection Serializer (`src/game-room/serializers/player-view.serializer.ts`)
- **Zero Leakage**: Enforces `isBot: false` across all serialized player objects sent over WebSockets.
- **Profile Injection**: Populates bot seats with authentic level, coins, stats, and avatar data so the Flutter client renders bots identically to real players.

### 2.6 Decoupled Game Gateway (`src/game-room/game.gateway.ts`)
- Implemented internal execution methods:
  - `executeSelectContract()`
  - `executeDeclareDouble()`
  - `executePlayCard()`
  - `executePassTrix()`
- Ensures that bot actions pass through the identical validation, state updates, turn switching, and client broadcasts as real WebSocket messages.

---

## 3. Production Issue Resolution & ESM Decoupling

During deployment to the Ubuntu Droplet (`157.230.239.31`), two critical runtime errors were encountered and resolved:

### 3.1 Node ESM Circular Dependency (TDZ)
- **Problem**: In Node.js native ESM (`"type": "module"`), circular class references cause `ReferenceError: Cannot access 'GameGateway' before initialization` because decorator reflection metadata (`design:paramtypes`) executes before imported modules finish initialization.
- **Solution**:
  1. Converted `GameGateway` imports in `bot-action.service.ts` and `bot-fill.service.ts` to type-only imports:
     ```typescript
     import type { GameGateway } from '../game-room/game.gateway.js';
     ```
  2. Removed `GameGateway` from service constructors and passed it via `setGateway()` during gateway initialization.
  3. Decoupled `GameRoomService` from `BotFillService` by using callback hooks (`onRoomCreated`, `onRoomDestroyed`) rather than constructor injection.

### 3.2 Production Startup Script (`start:prod`)
- **Problem**: Node ESM requires explicit file extensions. The script `"start:prod": "node dist/main"` threw `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../dist/main'`.
- **Solution**: Updated `package.json` to `"start:prod": "node dist/main.js"`.

---

## 4. Test Coverage & Verification

All 18 test suites and 100 tests pass cleanly:

| Test Suite | Tests | Status | Description |
|---|:---:|:---:|---|
| `src/bot/tests/bot-brain.spec.ts` | 11 | Passed | Contract evaluation, doubling heuristics, trick & trix plays |
| `src/bot/tests/bot-fill.spec.ts` | 2 | Passed | Matchmaking auto-fill, timer cancellation, staggered joins |
| `src/bot/tests/bot-action.spec.ts` | 4 | Passed | Latency jitter, one-card announcement, disconnect handover |
| `src/game-room/tests/game-room.service.spec.ts` | 7 | Passed | Room creation, seating, full lifecycle, disconnects |
| `src/game-room/tests/game.gateway.spec.ts` | 5 | Passed | WebSocket contract selection, doubling, trick plays |
| `src/game-room/tests/player-view-serializer.spec.ts` | 5 | Passed | Anti-cheat masking, zero-leak verification |
| `src/game-engine/tests/` | 33 | Passed | Pure trick engine, doubling, call-offs, trix contracts |
| `src/auth/auth.service.spec.ts` | 22 | Passed | Email & phone dual-auth, JWT tokens, refresh |
| `src/health/tests/`, `src/leaderboard/tests/`, etc. | 11 | Passed | System health, rankings, and user profiles |
| **Total** | **100** | **100% Passed** | **Zero errors, zero warnings** |

---

## 5. Summary of Modified Files

- `src/bot/bot-persona.data.ts`: Synthetic persona pool and randomization helper.
- `src/bot/bot-brain.service.ts`: Heuristic AI decision engine.
- `src/bot/bot-fill.service.ts`: Matchmaking backfill service with lifecycle listeners.
- `src/bot/bot-action.service.ts`: Latency simulation, action delays, and disconnect takeover.
- `src/bot/bot.module.ts`: NestJS module declaration.
- `src/game-room/game.gateway.ts`: Delegated execution methods and bot gateway wiring.
- `src/game-room/services/game-room.service.ts`: Lifecycle callbacks and grace timer management.
- `src/game-room/serializers/player-view.serializer.ts`: Anti-detection masking for Flutter.
- `package.json`: Updated `start:prod` to `node dist/main.js`.
- `docs/API_AND_EVENTS_REFERENCE.md`: Updated with `one_card_announcement` and room events.
