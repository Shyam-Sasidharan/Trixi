# TRIXI Backend: System Architecture & Database Design Specification

## 1. Executive Summary

The **Trixi** backend is a high-concurrency, real-time platform designed to power the Middle Eastern card game **Trix** (also known as Trex / تركس), supporting both **Solo** and **Partnership (Team)** modes across two kingdom styles: **Free Mercy** and **Crazy Complex**.

### Technology Stack
- **Framework**: [NestJS](https://nestjs.com/) (Express-based modular backend architecture)
- **Runtime & Language**: Node.js v20+, TypeScript (NodeNext / CommonJS resolution)
- **Primary Database**: [PostgreSQL](https://www.postgresql.org/) (`trix_db`)
- **Object-Relational Mapping (ORM)**: [Prisma ORM](https://www.prisma.io/) v6 with native `@prisma/adapter-pg` driver adapters
- **Caching & Ephemeral Storage**: [Redis](https://redis.io/) via `ioredis`
- **Testing Engine**: [Vitest](https://vitest.dev/) (39 automated unit tests)
- **Security & Cryptography**: `bcryptjs` password hashing, JSON Web Tokens (`@nestjs/jwt`)

---

## 2. Database Architecture & Schema Specification

The database layer is managed through Prisma using PostgreSQL. It uses native connection pooling via `pg.Pool` directly configured in [`src/prisma/prisma.service.ts`](file:///c:/xampp/htdocs/trix-backend/src/prisma/prisma.service.ts).

### 2.1 Entity-Relationship Diagram (ERD)

```mermaid
erDiagram
    User ||--o| UserStats : "has one (1:1)"
    User ||--o| UserSettings : "has one (1:1)"
    User ||--o{ MatchParticipant : "participates in (1:N)"
    User ||--o{ UserSubscription : "holds (1:N)"
    User ||--o{ RefreshToken : "owns (1:N)"
    MatchHistory ||--|{ MatchParticipant : "tracks (1:N)"

    User {
        uuid id PK
        string email UK
        string passwordHash
        string displayName
        string avatarUrl
        int level
        int xp
        int coins
        boolean isVip
        datetime createdAt
        datetime updatedAt
    }

    UserStats {
        uuid id PK
        uuid userId FK,UK
        int gamesPlayed
        int wins
        int losses
        int soloWins
        int teamWins
        int totalQueensCaptured
        int totalHeartsCaptured
        int trixFirstPlaceCount
    }

    UserSettings {
        uuid id PK
        uuid userId FK,UK
        AppTheme appTheme
        CardTheme cardTheme
        TableTheme tableTheme
        boolean soundEnabled
        boolean musicEnabled
        boolean vibrationEnabled
        boolean chatEnabled
    }

    MatchHistory {
        uuid id PK
        string roomId
        GameMode gameMode
        KingdomType kingdomType
        int winningScore
        json playerScores
        datetime createdAt
    }

    MatchParticipant {
        uuid id PK
        uuid matchId FK
        uuid userId FK
        int seatIndex
        int finalScore
        boolean isWinner
    }

    RefreshToken {
        uuid id PK
        uuid userId FK
        string tokenHash
        datetime expiresAt
        datetime createdAt
    }

    UserSubscription {
        uuid id PK
        uuid userId FK
        SubscriptionPlan planType
        SubscriptionStatus status
        string purchaseToken
        datetime expiresAt
        datetime createdAt
    }
```

---

### 2.2 Model Specifications

#### 1. `User`
The primary authentication and account entity.
- `id` (`UUID`, PK): Unique user identifier.
- `email` (`String`, Unique): Sanitized email address used for credential-based login.
- `passwordHash` (`String?`): Bcrypt hash with salt rounds = 10. Nullable for OAuth accounts.
- `displayName` (`String`): Public gamer tag / nickname.
- `avatarUrl` (`String?`): Public CDN URL to player avatar image.
- `level` (`Int`, Default: 1): Current account level.
- `xp` (`Int`, Default: 0): Experience points.
- `coins` (`Int`, Default: 1000): Virtual in-game currency starting balance.
- `isVip` (`Boolean`, Default: false): VIP subscriber status.
- `createdAt` / `updatedAt`: Timestamps.

#### 2. `UserSettings` (1:1 with `User`, Cascading Delete)
Stores visual, audio, and gameplay preferences.
- `appTheme` (`AppTheme`: `DARK`, `LIGHT`): Main interface theme.
- `cardTheme` (`CardTheme`: `CLASSIC`, `MODERN`, `LUXURY`): Card deck visual design.
- `tableTheme` (`TableTheme`: `GREEN_FELT`, `ROYAL_BLUE`, `BURGUNDY`): Gaming table felt color.
- `soundEnabled`, `musicEnabled`, `vibrationEnabled`, `chatEnabled` (`Boolean`, Default: true).

#### 3. `UserStats` (1:1 with `User`, Cascading Delete)
Tracks player metrics for matchmaking and global leaderboards.
- `gamesPlayed`, `wins`, `losses` (`Int`, Default: 0): Overall match outcomes.
- `soloWins`, `teamWins` (`Int`, Default: 0): Segregated victory counts.
- `totalQueensCaptured` (`Int`, Default: 0): Tracks captured Queens (negative contract defense metric).
- `totalHeartsCaptured` (`Int`, Default: 0): Tracks captured Hearts.
- `trixFirstPlaceCount` (`Int`, Default: 0): Number of times placing 1st (+200 pts) in the Trix shedding contract.

#### 4. `MatchHistory` & `MatchParticipant`
Maintains match archives and scoring history.
- `roomId` (`String`): Code of the game room.
- `gameMode` (`GameMode`: `SOLO`, `TEAM`): Team mode seats 0 & 2 together vs 1 & 3.
- `kingdomType` (`KingdomType`: `FREE_MERCY`, `CRAZY_COMPLEX`): Kingdom structure chosen.
- `winningScore` (`Int`): Highest score achieved in the match.
- `playerScores` (`Json`): Detailed end-of-game score breakdown across all 20 rounds.
- `MatchParticipant`: Junction record linking each user to their `seatIndex` (0–3), `finalScore`, and `isWinner` status.

#### 5. `RefreshToken`
Security model for JSON Web Token sessions.
- `tokenHash` (`String`): Secure hash of issued refresh tokens.
- `expiresAt` (`DateTime`): Expiration timestamp (7 days TTL).

#### 6. `UserSubscription`
Monetization and VIP subscription ledger.
- `planType` (`SubscriptionPlan`: `MONTHLY`, `ANNUAL`).
- `status` (`SubscriptionStatus`: `ACTIVE`, `EXPIRED`, `CANCELLED`).
- `purchaseToken` (`String`): App Store / Play Store validation receipt.
- `expiresAt` (`DateTime`): Access cutoff timestamp.

---

## 3. Phase 1: Authentication & User Management

### 3.1 Registration & ACID Onboarding
Implemented in [`src/auth/auth.service.ts`](file:///c:/xampp/htdocs/trix-backend/src/auth/auth.service.ts), registration executes inside an atomic Prisma `$transaction`:
1. Validates email uniqueness.
2. Generates a salt and hashes the password via `bcryptjs`.
3. Creates the `User`, default `UserSettings`, and zeroed `UserStats` records atomically.

### 3.2 Dual-Token Authentication Lifecycle
- **Access Token**: Short-lived (15 minutes). Payload includes `sub` (userId), `email`, and `displayName`.
- **Refresh Token**: Long-lived (7 days). Stored in both PostgreSQL (hashed) and Redis (`auth:refresh:<userId>:<tokenId>`).
- **Rotation on Refresh**: When `POST /auth/refresh` is called, the old refresh token is immediately deleted and replaced with a newly issued token pair.
- **Instant Revocation**: `POST /auth/logout` wipes the session from Redis and PostgreSQL.

### 3.3 Endpoint Directory

| Method | Route | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/register` | Registers new user with default stats & settings | No |
| `POST` | `/auth/login` | Validates credentials and returns JWT token pair | No |
| `POST` | `/auth/refresh` | Rotates refresh token and issues fresh access token | Yes (Refresh) |
| `POST` | `/auth/logout` | Revokes active token and destroys Redis session | Yes |
| `GET` | `/users/me` | Fetches authenticated player profile, stats & settings | Yes |
| `PATCH` | `/users/profile` | Updates display name or avatar URL | Yes |
| `PATCH` | `/users/settings` | Updates themes, sound, and gameplay preferences | Yes |
| `GET` | `/users/leaderboard`| Returns top players ranked by wins and XP | No |

---

## 4. Phase 2: Pure TypeScript Core Game Engine

The game engine is completely isolated inside [`src/game-engine/`](file:///c:/xampp/htdocs/trix-backend/src/game-engine/) as a **pure TypeScript domain layer**:
- **Zero NestJS decorators** (`@Injectable()`, etc.).
- **Zero Prisma/database imports**.
- **Zero WebSocket imports**.
- **100% deterministic functions and state machines**.

```mermaid
graph TD
    subgraph "TrixEngine Orchestrator"
        MatchState[Match State Machine<br/>4 Kingdoms x 5 Contracts = 20 Deals]
        Rotation[Counter-Clockwise Rotation<br/>Seat = seat + 3 mod 4]
    end

    subgraph "Deal & Pre-Play"
        Deck[Deck & 52-Card Deal] --> Owner[7 of Hearts Detection<br/>Designate Kingdom Owner]
        Owner --> CallOff{Pre-Deal Call-Off?}
        CallOff -->|Yes| Redeal[Void Deal & Redeal]
        CallOff -->|No| Doubling[Doubling Window<br/>Queens & K of Hearts]
    end

    subgraph "Contract Resolution"
        Doubling --> NegativeContract[Trick Engine: Negatives<br/>Queens, K of Hearts, Diamonds, Hands]
        Doubling --> TrixContract[Trix Ladder Contract<br/>Jacks open, Ladders build 2 to Ace]
    end

    MatchState --> Deck
```

---

### 4.1 Card & Power Definitions ([`card.types.ts`](file:///c:/xampp/htdocs/trix-backend/src/game-engine/types/card.types.ts))
- **Suits**: `HEARTS (♥)`, `DIAMONDS (♦)`, `CLUBS (♣)`, `SPADES (♠)`.
- **Ranks & Powers**:
  - `2=2`, `3=3`, `4=4`, `5=5`, `6=6`, `7=7`, `8=8`, `9=9`, `10=10`
  - `Jack (J) = 11`
  - `Queen (Q) = 12`
  - `King (K) = 13`
  - `Ace (A) = 14`

---

### 4.2 Deck & Deal Engine ([`deck.ts`](file:///c:/xampp/htdocs/trix-backend/src/game-engine/deck.ts))
- **Fisher-Yates Shuffle**: Fully randomized or seeded via a PRNG function for deterministic testing.
- **Deal Allocation**: 13 cards dealt to each of 4 seats (0, 1, 2, 3).
- **First Kingdom Owner**: Automatically identified by locating the holder of **7♥**.
- **Counter-Clockwise Turn Rotation**: Progression proceeds strictly to the player's right:
  $$\text{Next Seat} = (\text{Current Seat} + 3) \pmod 4 \quad (0 \to 3 \to 2 \to 1)$$
- **Team Seat Allocation**:
  - Team 1 = Seats 0 & 2
  - Team 2 = Seats 1 & 3

---

### 4.3 Pre-Deal Automatic Call-Off Engine ([`call-off.validator.ts`](file:///c:/xampp/htdocs/trix-backend/src/game-engine/call-off.validator.ts))
Enforces mandatory redeals when severe hand imbalances occur:
1. **King of Hearts Call-Off** (`isKingOfHeartsCallOff`):
   - Triggers if a player holds solitary `K♥` (no other Hearts).
   - Triggers if a player holds `K♥` and `A♥` with no other Hearts.
   - Result: Hand is automatically voided and re-dealt without score penalty.
2. **Trix Call-Off** (`isTrixCallOff`):
   - Triggers if a player holds all four `2`s (`2♦`, `2♣`, `2♥`, `2♠`).
   - Triggers if a player holds three `2`s plus the `3` of the remaining suit (e.g., `2♦, 2♣, 2♥, 3♠`).
   - Result: Trix deal is voided and re-dealt.

---

### 4.4 Doubling Resolution Engine ([`doubling.ts`](file:///c:/xampp/htdocs/trix-backend/src/game-engine/doubling.ts))
Doubling occurs prior to contract play for `QUEENS` and `KING_OF_HEARTS`:
- Any player holding a Queen may double it (revealed publicly).
- The player holding `K♥` may double it (revealed publicly).

#### Scoring Allocations:
- **Solo Mode**:
  - Opponent captures doubled card: Collector receives penalty (**-50** for Q, **-150** for K♥); Doubler receives bonus (**+25** for Q, **+75** for K♥).
  - Doubler captures their own doubled card (self-take fault): Doubler pays full penalty (**-50** or **-150**); the player who led the trick receives the bonus (**+25** or **+75**).
- **Team Mode**:
  - Opposing team captures: Collector's Team receives **-50** or **-150**; Doubler's Team receives **+25** or **+75**.
  - Doubler's team captures (either doubler or teammate): Doubler's Team pays full penalty (**-50** or **-150**); Opponent Team receives **+25** or **+75**.

---

### 4.5 Trick Engine for Negative Contracts ([`trick-engine.ts`](file:///c:/xampp/htdocs/trix-backend/src/game-engine/trick-engine.ts))

#### Negative Contract Values:
- **Queens**: -25 each (-50 if doubled) $\to$ Total pool: -100 (-200 if all doubled).
- **King of Hearts**: -75 (-150 if doubled).
- **Diamonds**: -10 per card $\to$ Total pool: -130 across 13 Diamonds.
- **Hands (Lutoush)**: -15 per trick $\to$ Total pool: -195 across 13 tricks.

#### Validation & Play Rules:
- **Follow-Suit Mandatory**: A player holding cards in the led suit must follow suit.
- **Discarding (Sloughing)**: If void in the led suit, any card of any other suit may be played.
- **Trick Winner**: Highest power card of the led suit takes the trick. No trumps exist.
- **Lead Restrictions**:
  - *Free Mercy*: Diamonds cannot be led until Diamonds have been broken in an earlier trick, unless the leader holds only Diamonds.
  - *Crazy Complex*: Diamonds can be led at any time, including Trick 1.
  - *King of Hearts*: Hearts cannot be led until broken, unless the leader holds only Hearts.
- **13-Diamond Sweep**: If a single player captures all 13 Diamonds in a single deal:
  - In *Free Mercy*: Diamond scores are cancelled; Diamond contract is re-dealt.
  - In *Crazy Complex*: All 4 negative contract scores are cancelled; the combined contract is re-dealt.

---

### 4.6 Trix Shedding Contract Engine ([`contracts/trix.contract.ts`](file:///c:/xampp/htdocs/trix-backend/src/game-engine/contracts/trix.contract.ts))
- **Table Layout**: 4 suit columns initiated strictly with Jacks (`J`).
- **Ladder Construction**:
  - Upward: `J -> Q -> K -> A`
  - Downward: `J -> 10 -> 9 -> 8 -> 7 -> 6 -> 5 -> 4 -> 3 -> 2`
- **Strict Mandatory Play Rule**: Passing is strictly rejected if `getPlayableCards().length > 0`.
- **Finishing Scoring Table**:
  - **1st Place**: $+200$ points
  - **2nd Place**: $+150$ points
  - **3rd Place**: $+100$ points
  - **4th Place**: $+50$ points
  - **Total Trix Pool**: $+500$ points

---

## 5. Automated Verification & Test Results

The engine is verified through **39 automated unit tests** in Vitest:

```text
 ✓ src/game-engine/tests/trix.spec.ts (5 tests)
 ✓ src/game-engine/tests/call-offs.spec.ts (9 tests)
 ✓ src/game-engine/tests/doubling.spec.ts (10 tests)
 ✓ src/game-engine/tests/trick-engine.spec.ts (9 tests)
 ✓ src/game-room/game.gateway.spec.ts (1 test)
 ✓ src/app.controller.spec.ts (1 test)
 ✓ src/game-room/services/game-room.service.spec.ts (1 test)
 ✓ src/matchmaking/matchmaking.service.spec.ts (1 test)
 ✓ src/users/users.service.spec.ts (1 test)
 ✓ src/auth/auth.service.spec.ts (1 test)

 Test Files  10 passed (10)
      Tests  39 passed (39)
   Duration  6.20s
```

TypeScript compilation status (`nest build`): **0 errors**.

---

## 6. Repository & Environment Setup

- **GitHub Repository**: [https://github.com/Shyam-Sasidharan/Trixi.git](https://github.com/Shyam-Sasidharan/Trixi.git)
- **Active Branch**: `main`

### Environment Configuration (`.env.example`)
```env
PORT=3000

# PostgreSQL
DATABASE_URL="postgresql://postgres:password@localhost:5432/trix_db?schema=public"

# Redis
REDIS_HOST="127.0.0.1"
REDIS_PORT=6379

# JWT Secrets
JWT_SECRET="trix-secret-key-change-in-production"
JWT_REFRESH_SECRET="trix-refresh-secret-key-change-in-production"
```
