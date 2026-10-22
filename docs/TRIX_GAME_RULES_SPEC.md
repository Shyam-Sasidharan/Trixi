# TRIX (تركس) Mathematical Game Engine Specification

This document provides the definitive game logic and mathematical scoring specification governing the **TRIXI** backend engine.

---

## 1. Match Hierarchy & Progression

### 1.1 Kingdoms & Deals
- A complete match consists of **4 Kingdoms** (one owned by each player).
- In each Kingdom, the Kingdom Owner plays **5 Contracts**:
  1. **King of Hearts** (`KING_OF_HEARTS` / الشيخ)
  2. **Queens** (`QUEENS` / البنات)
  3. **Diamonds** (`DIAMONDS` / الديناري)
  4. **Hands** (`HANDS` / اللطوش)
  5. **Trix** (`TRIX` / تركس)
- Total match duration: $4 \text{ Kingdoms} \times 5 \text{ Contracts} = 20 \text{ total deals}$.

### 1.2 Initial Ownership & Turn Rotation
- **Deck**: Standard 52-card deck without jokers.
- **Deal**: 13 cards dealt to each of 4 seats (Seats 0, 1, 2, 3).
- **First Owner**: Identified automatically by scanning all 4 hands for the holder of the **Seven of Hearts (7♥)**.
- **Counter-Clockwise Progression**:
  Turn and kingdom progression proceeds strictly to the player's right (counter-clockwise):
  $$\text{Next Seat} = (\text{Current Seat} + 3) \pmod 4 \quad (0 \to 3 \to 2 \to 1)$$
- **Team Seat Allocation** (Team Mode):
  - **Team 1**: Seats 0 & 2
  - **Team 2**: Seats 1 & 3

---

## 2. Kingdom Types & Contract Selection

### 2.1 Free Mercy (مملكة حرة)
The Kingdom Owner plays each of the 5 contracts in any order they choose:
- Can choose negative contracts individually (1 at a time).
- Can optionally combine 2, 3, or all 4 negative contracts into a single deal (e.g. Queens + King of Hearts).
- **Trix** must strictly be played alone.

### 2.2 Crazy Complex (كومبلكس)
The Kingdom Owner plays only 2 rounds per Kingdom:
1. **The Combined Negative Round**: All 4 negative contracts combined into one 13-trick deal (`QUEENS` + `KING_OF_HEARTS` + `DIAMONDS` + `HANDS`).
2. **The Trix Round**: Standard `TRIX` ladder contract.

---

## 3. Pre-Deal Automatic Call-Off Engine

Before contract play commences, hands are automatically evaluated. If an insurmountable hand imbalance is detected, the deal is automatically voided and re-dealt without penalty.

### 3.1 King of Hearts Call-Off (`isKingOfHeartsCallOff`)
Triggers during any deal containing the `KING_OF_HEARTS` contract if:
1. A player holds `K♥` as their **only** Heart card.
2. A player holds `K♥` and `A♥` and **no other** Heart cards.

*Rule Outcome*: Hand is declared void; deck is reshuffled and re-dealt.

### 3.2 Trix Call-Off (`isTrixCallOff`)
Triggers during the `TRIX` contract if:
1. A player holds **all four 2s** (`2♦, 2♣, 2♥, 2♠`).
2. A player holds **three 2s plus the 3 of the remaining suit** (e.g., `2♦, 2♣, 2♥, 3♠`).

*Rule Outcome*: Trix deal is declared void; deck is reshuffled and re-dealt.

---

## 4. Doubling Resolution Engine (التدبيل)

Prior to trick play in deals containing `QUEENS` or `KING_OF_HEARTS`, an 8-second doubling phase opens.
- Any player holding a Queen may double it (exposed face-up on table).
- The player holding `K♥` may double it (exposed face-up on table).

### 4.1 Solo Mode Resolution

| Scenario | Doubler Outcome | Collector Outcome | Trick Leader Outcome |
| :--- | :--- | :--- | :--- |
| **Opponent Captures Doubled Card** | $+25$ (Queen)<br/>$+75$ (K♥) | $-50$ (Queen)<br/>$-150$ (K♥) | $0$ |
| **Doubler Captures Own Doubled Card (Self-Take)** | $-50$ (Queen)<br/>$-150$ (K♥) | N/A (Doubler took it) | $+25$ (Queen)<br/>$+75$ (K♥) |

### 4.2 Team Mode Resolution

| Scenario | Doubler's Team Outcome | Opponent Team Outcome |
| :--- | :--- | :--- |
| **Opposing Team Captures** | $+25$ (Queen) / $+75$ (K♥) | $-50$ (Queen) / $-150$ (K♥) |
| **Doubler's Team Captures (Partner-Take or Self-Take)** | $-50$ (Queen) / $-150$ (K♥) | $+25$ (Queen) / $+75$ (K♥) |

---

## 5. Trick Engine & Negative Contracts

### 5.1 Play & Leading Rules
- **Follow Suit Mandatory**: If a player holds any card of the led suit, they must follow suit.
- **Sloughing**: If void in the led suit, any card may be discarded.
- **Trick Winner**: Highest power card of the led suit captures the trick (no trump suit).
- **Lead Restrictions**:
  - *Free Mercy*: Diamonds cannot be led until Diamonds have been broken in a previous trick, unless the player holds only Diamonds.
  - *Crazy Complex*: Diamonds can be led on Trick 1.
  - *King of Hearts*: Hearts cannot be led until broken, unless the player holds only Hearts.

### 5.2 Negative Scoring Table

| Contract | Value per Card / Trick | Total Deal Pool |
| :--- | :--- | :--- |
| **Queens** | $-25$ each ($-50$ if doubled) | $-100$ ($-200$ if all doubled) |
| **King of Hearts** | $-75$ ($-150$ if doubled) | $-75$ ($-150$ if doubled) |
| **Diamonds** | $-10$ each | $-130$ (across 13 cards) |
| **Hands (Tricks)** | $-15$ per trick | $-195$ (across 13 tricks) |
| **Combined Negatives** | Sum of above | $-500$ ($-675$ if all doubled) |

### 5.3 13-Diamond Sweep Reset (كبّة الديناري)
If a single player captures all 13 Diamonds in a single deal:
- **Free Mercy** (Diamond alone): Diamond contract scores are cancelled; Diamond contract is re-dealt.
- **Crazy Complex** (or all 4 negatives): All 4 negative contract scores are cancelled; the entire combined contract is re-dealt.

---

## 6. Trix Contract Engine (سيد اللعبة)

- **Table Layout**: 4 suit columns initiated strictly with Jacks (`J`).
- **Ladder Construction**:
  - Upward: `J -> Q -> K -> A`
  - Downward: `J -> 10 -> 9 -> 8 -> 7 -> 6 -> 5 -> 4 -> 3 -> 2`
- **Mandatory Play Rule**: A player is **strictly forbidden to pass** if they hold any playable card adjacent to table bounds or an unopened Jack. Attempting to pass throws a validation error.
- **Finishing Scoring Table**:

| Placement | Points Awarded |
| :--- | :--- |
| **1st Place** (First to empty hand) | $+200$ |
| **2nd Place** | $+150$ |
| **3rd Place** | $+100$ |
| **4th Place** (Last player holding cards) | $+50$ |
| **Total Trix Deal Pool** | **$+500$ points** |

---

## 7. Match Victory Determination

At the end of 20 deals, total scores are summed.
- In **Solo Mode**, the player with the highest overall score wins.
- In **Team Mode**, scores for Seats $0 + 2$ (Team 1) and Seats $1 + 3$ (Team 2) are summed. The team with the highest combined total wins.
- Ties are supported and handled cleanly in the result matrix.
