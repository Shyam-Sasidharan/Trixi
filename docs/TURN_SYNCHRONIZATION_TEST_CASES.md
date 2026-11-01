# TRIXI Multiplayer — Turn Synchronization & Indicator Test Cases

**Target Platforms:** Flutter Client (`/trix-mobile` or `/frontend`) & NestJS Authoritative Backend  
**Document Version:** 1.0.0  
**Scope:** Active Seat Indicators, Perspective Seat Rotation, Turn Countdown Timer, and Anti-Desync Packet Guards  
**Status:** Approved for QA and Release-Gate Verification  

---

## 1. Problem Diagnosis & Architectural Context

During active gameplay, some players experience a total loss of turn indication:
- The UI fails to highlight the active player's avatar/seat.
- The local player's cards remain unplayable/disabled because the client cannot recognize that `currentTurnSeat == mySeat`.
- No countdown clock or turn timer is displayed for the table.

### Root Causes & Remediation Summary

1. **Seat Normalization & Perspective Rotation Mismatch (Frontend):**
   - The Flutter table UI renders the local user at the bottom (`Relative Seat 0: Bottom`).
   - Inbound socket events convey absolute seat indices (`0..3`).
   - If the client fails to normalize absolute seats to relative seats using `(targetSeat - mySeat + 4) % 4`, or compares the active seat against an un-rotated index, highlight conditions evaluate to `false` across all seats.
2. **Type Coercion & Payload Field Desync (Backend $\rightarrow$ Frontend):**
   - If a JSON parser expects an `int` but receives a string or null (or if `currentPhase` vs `gamePhase` is mismatched), parsing silently fails or assigns fallback values (`-1` or `null`).
   - **Backend Fix:** Backend guarantees `currentTurnSeat`, `mySeat`, and `kingdomOwnerSeat` are strictly serialized as integers, and both `currentPhase` and `gamePhase` are provided with identical values.
3. **Turn ID / State Version Stale Overwrites (Frontend):**
   - Delayed `timer_tick` or lagging network packets with an older `turnId` or `roomSequence` overwrite fresh local turn state.
   - **Frontend Fix:** Strict packet drops based on `roomSequence` and `turnId`.
4. **Phase Guard Mismatch:**
   - Active turn indicators and interactive card taps must be enabled specifically during `TRICK_PLAY` and `TRIX_PLAY`, while displaying the contract selection modal during `KINGDOM_SELECTION` and doubling badges during `DOUBLING_PHASE`.

---

## 2. Test Cases Specification

| Test ID | Scenario | Preconditions / Setup | Action / Input | Expected Result |
| :--- | :--- | :--- | :--- | :--- |
| **TC-TURN-01** | Local Turn Detection (Bottom Player) | Match in `TRICK_PLAY`. Local player is Seat 2 (`mySeat: 2`). | Server broadcasts `game_state` with `currentTurnSeat: 2`. | 1. Local hand becomes interactive (`canPlayCard: true`).<br>2. Bottom avatar pulses or highlights with the active turn halo.<br>3. Turn countdown displays above local hand (`remainingSeconds: 20 ... 0`). |
| **TC-TURN-02** | Opponent Turn Detection (Rotated Seats) | Match in `TRICK_PLAY`. Local player is Seat 0 (`mySeat: 0`). Active turn is Seat 3 (`currentTurnSeat: 3`). | Server broadcasts `game_state` with `currentTurnSeat: 3`. | 1. Seat 3 (rendered at Left relative to Seat 0) displays active turn indicator.<br>2. Local player cards remain disabled.<br>3. Active countdown shows next to Seat 3. |
| **TC-TURN-03** | Rotated Perspective Consistency | 4 clients connected to Room A (Seats 0, 1, 2, 3). Active turn is Seat 1. | Inspect screens of all 4 connected devices simultaneously. | **All 4 devices must highlight the exact same player avatar** (Seat 1) regardless of local seat rotation. |
| **TC-TURN-04** | Type Parsing Resilience | Server transmits `{ "currentTurnSeat": "1", "turnId": 5 }` (string instead of int). | Flutter parses inbound `game_state` payload. | `GameStateModel.fromJson` coerces `"1"` $\rightarrow$ `1` without setting field to `null`. Turn indicator renders correctly. |
| **TC-TURN-05** | Reconnection Turn Hydration | Player at Seat 1 disconnects on their turn, reconnects after 5s. | Client emits `reconnect_game` and receives full snapshot. | Restored state preserves `currentTurnSeat: 1`, `turnId`, and `deadlineAt`. Local cards immediately unlock for play. |
| **TC-TURN-06** | Out-of-Order Packet Guard | Current turn is `turnId: 3` (`currentTurnSeat: 2`). | Client receives lagging `timer_tick` containing `turnId: 2` (`currentTurnSeat: 1`). | Client drops stale packet based on `turnId` / `roomSequence`. Active turn remains Seat 2. |

---

## 3. Step-by-Step Test Execution Protocols

### TC-TURN-01: Local Turn Detection (Bottom Player)
1. **Setup:**
   - Launch Flutter app as User B.
   - Join Room X. User B is assigned **Seat 2**.
   - Contract is set to `HANDS` (`currentPhase: "TRICK_PLAY"`).
2. **Execution:**
   - Server emits `game_state` with `{ "currentTurnSeat": 2, "mySeat": 2, "turnTimeLimit": 20 }`.
3. **Verification Points:**
   - `[ ]` Local cards in bottom hand area show elevated shadow, full opacity, and respond to tap/drag.
   - `[ ]` Bottom player profile avatar displays an animated border / glow ring (Active Turn Halo).
   - `[ ]` A circular countdown or progress bar displays decreasing from 20 seconds.
   - `[ ]` Opponent avatars at Left, Top, and Right have no active halo.

---

### TC-TURN-02: Opponent Turn Detection (Rotated Perspective)
1. **Setup:**
   - Launch Flutter app as User A (Seat 0).
   - Active turn passes to Seat 3.
2. **Execution:**
   - Server emits `game_state` with `{ "currentTurnSeat": 3, "mySeat": 0 }`.
3. **Verification Points:**
   - `[ ]` Local cards at the bottom are dimmed/disabled (`canPlay: false`). Tapping cards produces no network dispatch or shows gentle hint `"Wait for your turn"`.
   - `[ ]` Seat 3 avatar is rendered at the **Left** position on Seat 0's screen:
     $$\text{Relative Seat} = (3 - 0 + 4) \pmod 4 = 3 \quad (\text{Left})$$
   - `[ ]` The Left avatar glows with the active turn halo.
   - `[ ]` Turn timer displays above/beside the Left avatar.

---

### TC-TURN-03: 4-Device Perspective Consistency Matrix
When Seat 1 has the turn, verify how each device renders Seat 1:

| Device View | Local Seat (`mySeat`) | Target Active Seat | Relative Seat Formula | Rendered Position | Visual Highlight |
|---|---|---|---|---|---|
| **Device 0** | Seat 0 | Seat 1 | $(1 - 0 + 4) \pmod 4 = 1$ | **Right** | Right Avatar Glowing |
| **Device 1** | Seat 1 | Seat 1 | $(1 - 1 + 4) \pmod 4 = 0$ | **Bottom** (Local) | Bottom Hand & Avatar Glowing |
| **Device 2** | Seat 2 | Seat 1 | $(1 - 2 + 4) \pmod 4 = 3$ | **Left** | Left Avatar Glowing |
| **Device 3** | Seat 3 | Seat 1 | $(1 - 3 + 4) \pmod 4 = 2$ | **Top** | Top Avatar Glowing |

**Assertion:** Across all 4 devices, the identical human player (Seat 1) is highlighted.

---

### TC-TURN-04: Type Parsing Resilience
1. **Setup:**
   - Emulate inbound socket payload with mixed string and number values:
     ```json
     {
       "currentTurnSeat": "1",
       "mySeat": "2",
       "kingdomOwnerSeat": 0,
       "turnId": "4",
       "roomSequence": 15
     }
     ```
2. **Verification Points:**
   - `[ ]` `GameStateModel.fromJson` safely coerces `"1"` to integer `1` and `"2"` to integer `2`.
   - `[ ]` No `FormatException` or `TypeError` thrown.
   - `[ ]` UI state evaluates `isMyTurn: false` and highlights relative seat 3 (Left).

---

### TC-TURN-05: Reconnection Turn Hydration
1. **Setup:**
   - Player at Seat 1 has the active turn (`currentTurnSeat: 1`).
   - Disconnect network or background the Flutter application for 5 seconds.
2. **Execution:**
   - Bring app back to foreground (`AppLifecycleState.resumed`).
   - Client sends `reconnect_game`.
3. **Verification Points:**
   - `[ ]` Client receives full `game_state` snapshot.
   - `[ ]` State is immediately hydrated with `currentTurnSeat: 1` and `mySeat: 1`.
   - `[ ]` `deadlineAt` is used to restore the exact remaining turn seconds without resetting back to 20s.
   - `[ ]` Local player cards unlock instantly.

---

### TC-TURN-06: Out-of-Order Packet Guard
1. **Setup:**
   - Local state is at `roomSequence: 25`, `turnId: 4`, `currentTurnSeat: 2`.
2. **Execution:**
   - Server (or lagged socket network buffer) delivers a late `timer_tick`:
     `{ "roomSequence": 23, "turnId": 3, "currentTurnSeat": 1, "remainingSeconds": 2 }`
3. **Verification Points:**
   - `[ ]` Client packet filter detects `incomingSeq (23) < lastSeenSeq (25)`.
   - `[ ]` Packet is discarded immediately.
   - `[ ]` Active turn remains Seat 2; no flickers or reversion to Seat 1.

---

## 4. Required Flutter Code Implementations

### 4.1 Perspective Seat Normalization (`table_rotation.dart`)

```dart
/// Maps an absolute server seat index (0..3) to the local player's visual perspective.
/// Relative Positions:
/// 0: Bottom (Local User)
/// 1: Right
/// 2: Top
/// 3: Left
enum TablePosition { bottom, right, top, left }

TablePosition getTablePosition({
  required int targetSeat,
  required int mySeat,
}) {
  final int relativeIndex = (targetSeat - mySeat + 4) % 4;
  switch (relativeIndex) {
    case 0:
      return TablePosition.bottom;
    case 1:
      return TablePosition.right;
    case 2:
      return TablePosition.top;
    case 3:
      return TablePosition.left;
    default:
      return TablePosition.bottom;
  }
}

/// Helper to determine if a specific seat currently holds the active turn
bool isSeatActiveTurn({
  required int seatIndex,
  required int currentTurnSeat,
  required String currentPhase,
}) {
  // Only highlight turns during TRICK_PLAY or TRIX_PLAY
  if (currentPhase != 'TRICK_PLAY' && currentPhase != 'TRIX_PLAY') {
    return false;
  }
  return seatIndex == currentTurnSeat;
}
```

---

### 4.2 Resilient JSON Deserializer (`game_state_model.dart`)

```dart
class GameStateModel {
  final String roomId;
  final String currentPhase;
  final int currentTurnSeat;
  final int mySeat;
  final int kingdomOwnerSeat;
  final int turnId;
  final int stateVersion;
  final int roomSequence;
  final int? deadlineAt;
  final int? serverTime;
  final List<CardModel> myHand;
  final List<OpponentModel> opponents;

  GameStateModel({
    required this.roomId,
    required this.currentPhase,
    required this.currentTurnSeat,
    required this.mySeat,
    required this.kingdomOwnerSeat,
    required this.turnId,
    required this.stateVersion,
    required this.roomSequence,
    this.deadlineAt,
    this.serverTime,
    required this.myHand,
    required this.opponents,
  });

  /// Helper to safely coerce int from dynamic (int, String, or null)
  static int _parseInt(dynamic value, [int defaultValue = 0]) {
    if (value is int) return value;
    if (value is String) return int.tryParse(value) ?? defaultValue;
    if (value is num) return value.toInt();
    return defaultValue;
  }

  factory GameStateModel.fromJson(Map<String, dynamic> json) {
    // Support both canonical currentPhase and legacy gamePhase
    final String phase = (json['currentPhase'] ?? json['gamePhase'] ?? '').toString();

    return GameStateModel(
      roomId: json['roomId'] ?? '',
      currentPhase: phase,
      currentTurnSeat: _parseInt(json['currentTurnSeat'], 0),
      mySeat: _parseInt(json['mySeat'], 0),
      kingdomOwnerSeat: _parseInt(json['kingdomOwnerSeat'], 0),
      turnId: _parseInt(json['turnId'], 1),
      stateVersion: _parseInt(json['stateVersion'], 1),
      roomSequence: _parseInt(json['roomSequence'], 0),
      deadlineAt: json['deadlineAt'] != null ? _parseInt(json['deadlineAt']) : null,
      serverTime: json['serverTime'] != null ? _parseInt(json['serverTime']) : null,
      myHand: (json['myHand'] as List<dynamic>? ?? [])
          .map((c) => CardModel.fromJson(c as Map<String, dynamic>))
          .toList(),
      opponents: (json['opponents'] as List<dynamic>? ?? [])
          .map((o) => OpponentModel.fromJson(o as Map<String, dynamic>))
          .toList(),
    );
  }

  /// Convenience getter for whether local player can make a move
  bool get isMyTurn {
    if (currentPhase != 'TRICK_PLAY' && currentPhase != 'TRIX_PLAY') {
      return false;
    }
    return currentTurnSeat == mySeat;
  }
}
```

---

### 4.3 Stale Packet Guard in Socket Controller (`trix_socket_controller.dart`)

```dart
class TrixSocketController {
  int _lastSeenSequence = -1;
  int _currentTurnId = -1;

  void handleInboundEvent(String eventName, Map<String, dynamic> payload) {
    // 1. Packet Sequence Filter
    final dynamic rawSeq = payload['roomSequence'];
    if (rawSeq != null) {
      final int seq = rawSeq is int ? rawSeq : int.tryParse(rawSeq.toString()) ?? 0;
      if (seq < _lastSeenSequence) {
        // Drop lagging out-of-order packet
        print('[$eventName] Dropping stale packet seq: $seq < $_lastSeenSequence');
        return;
      }
      _lastSeenSequence = seq;
    }

    // 2. Turn ID check for timer ticks
    if (eventName == 'timer_tick') {
      final dynamic rawTurnId = payload['turnId'];
      if (rawTurnId != null) {
        final int tickTurnId = rawTurnId is int ? rawTurnId : int.tryParse(rawTurnId.toString()) ?? 0;
        if (tickTurnId < _currentTurnId) {
          print('[timer_tick] Dropping tick from previous turn: $tickTurnId < $_currentTurnId');
          return;
        }
      }
      _updateCountdownTimer(payload);
      return;
    }

    // 3. Game State updates
    if (eventName == 'game_state') {
      final state = GameStateModel.fromJson(payload);
      _currentTurnId = state.turnId;
      _updateGameState(state);
    }
  }

  void _updateCountdownTimer(Map<String, dynamic> data) {
    // Epoch timestamp synchronization
    final int? deadlineAt = data['deadlineAt'] != null ? int.tryParse(data['deadlineAt'].toString()) : null;
    final int? serverTime = data['serverTime'] != null ? int.tryParse(data['serverTime'].toString()) : null;

    if (deadlineAt != null && serverTime != null) {
      final int clientClockOffset = DateTime.now().millisecondsSinceEpoch - serverTime;
      final int adjustedNow = DateTime.now().millisecondsSinceEpoch - clientClockOffset;
      final int remainingSeconds = ((deadlineAt - adjustedNow) / 1000).ceil().clamp(0, 30);
      _timerSubject.add(remainingSeconds);
    } else {
      final int seconds = data['remainingSeconds'] ?? 0;
      _timerSubject.add(seconds);
    }
  }

  void _updateGameState(GameStateModel state) {
    // Broadcast state to UI stores
  }
}
```

---

### 4.4 Avatar Turn Halo & Timer Widget (`player_avatar_area.dart`)

```dart
class PlayerAvatarArea extends StatelessWidget {
  final int absoluteSeat;
  final GameStateModel gameState;
  final String displayName;
  final String? avatarUrl;

  const PlayerAvatarArea({
    Key? key,
    required this.absoluteSeat,
    required this.gameState,
    required this.displayName,
    this.avatarUrl,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    // 1. Calculate relative table position (bottom, right, top, left)
    final position = getTablePosition(
      targetSeat: absoluteSeat,
      mySeat: gameState.mySeat,
    );

    // 2. Check if this specific player has active turn
    final bool isTurn = isSeatActiveTurn(
      seatIndex: absoluteSeat,
      currentTurnSeat: gameState.currentTurnSeat,
      currentPhase: gameState.currentPhase,
    );

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Stack(
          alignment: Alignment.center,
          children: [
            // Active Turn Glow Ring
            if (isTurn)
              AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.amberAccent, width: 3),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.amber.withOpacity(0.6),
                      blurRadius: 12,
                      spreadRadius: 2,
                    ),
                  ],
                ),
              ),

            // Avatar Image
            CircleAvatar(
              radius: 30,
              backgroundImage: avatarUrl != null ? NetworkImage(avatarUrl!) : null,
              child: avatarUrl == null ? Text(displayName.isNotEmpty ? displayName[0] : '?') : null,
            ),
          ],
        ),

        const SizedBox(height: 4),

        // Player Name
        Text(
          displayName,
          style: TextStyle(
            color: isTurn ? Colors.amberAccent : Colors.white70,
            fontWeight: isTurn ? FontWeight.bold : FontWeight.normal,
            fontSize: 12,
          ),
        ),

        // Active Turn Timer Badge
        if (isTurn)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: TurnCountdownBadge(gameState: gameState),
          ),
      ],
    );
  }
}
```

---

## 5. QA Verification Sign-off Matrix

| Verification Item | Pass Criteria | Tester Sign-off |
|---|---|---|
| **Local Turn Halo** | Golden pulsing halo appears around local avatar when `currentTurnSeat == mySeat`. | `[ ]` PASS |
| **Local Card Interactivity** | Cards in bottom hand are clickable ONLY on local turn; dim and unclickable on opponent turns. | `[ ]` PASS |
| **Opponent Turn Halo** | Halo tracks counter-clockwise across Right $\rightarrow$ Top $\rightarrow$ Left as turns advance. | `[ ]` PASS |
| **Consistent View Across 4 Devices** | When Seat 2 plays, all 4 players see Seat 2 highlighted at their respective perspective angles. | `[ ]` PASS |
| **Reconnection State Preservation** | Reconnecting player immediately sees the current turn halo and remaining countdown without refresh. | `[ ]` PASS |
| **No Lag Packet Reversion** | Late packets from older turns do not revert the turn indicator backward. | `[ ]` PASS |
