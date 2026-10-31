import { Card, Suit } from '../../game-engine/types/card.types.js';
import {
  ContractType,
  GameMode,
  KingdomType,
} from '../../game-engine/types/contract.types.js';
import {
  GamePhase,
  MatchState,
  TrixColumns,
} from '../../game-engine/types/engine.types.js';
import { sortHand } from '../../game-engine/deck.js';

export interface OpponentView {
  seat: number;
  remainingCardCount: number;
  isConnected: boolean;
  isDoublingAnnounced: boolean;
  isBot?: boolean;
  displayName?: string;
  avatarUrl?: string;
  level?: number;
  coins?: number;
  stats?: any;
}

export interface PlayerSeatInfo {
  seat: number;
  userId?: string;
  socketId?: string;
  displayName?: string;
  avatarUrl?: string;
  isConnected: boolean;
  isBot?: boolean;
  level?: number;
  coins?: number;
  stats?: any;
}

export interface SanitizedPlayerGameState {
  roomId: string;
  gamePhase: GamePhase;
  kingdomIndex: number; // 1 to 4
  kingdomOwnerSeat: number;
  currentTurnSeat: number;
  activeContracts: ContractType[];
  kingdomType: KingdomType;
  gameMode: GameMode;
  turnTimeLimit: number; // in seconds (10, 20, 30)
  mySeat: number;
  myHand: Card[]; // STRICTLY target player's cards, sorted by suit/power
  opponents: OpponentView[]; // Opponents with ONLY card counts, zero-trust
  doubledCardsOnTable: Array<{ card: Card; declaredBySeat: number }>;
  currentTrick: Array<{ seat: number; card: Card }>;
  trixColumns: TrixColumns;
  scores: {
    totalScores: Record<number, number>;
    roundScores: Record<number, number>[];
  };
  lastTrickWinner: number | null;
  isDoublingPhase: boolean;
  canDoubleCards: Card[];
  turnId?: number;
  stateVersion?: number;
  turnDeadlineTimestamp?: number | null;
  roomSequence?: number;
  serverTime?: number;
  deadlineAt?: number | null;
}

export class PlayerViewSerializer {
  /**
   * Transforms authoritative internal match state into a safe, anti-cheat player view.
   * Opponents' hidden cards are strictly stripped to prevent client-side inspection / packet sniffing.
   */
  public static serialize(
    matchState: MatchState,
    targetSeat: number,
    roomId: string,
    options?: {
      turnTimeLimit?: number;
      seatsInfo?: Record<number, PlayerSeatInfo>;
      turnId?: number;
      stateVersion?: number;
      turnDeadlineTimestamp?: number | null;
      roomSequence?: number;
      serverTime?: number;
      deadlineAt?: number | null;
    },
  ): SanitizedPlayerGameState {
    if (targetSeat < 0 || targetSeat > 3) {
      throw new Error(`Invalid targetSeat: ${targetSeat}. Must be between 0 and 3.`);
    }

    const rawHand = matchState.hands[targetSeat] || [];
    const sortedHand = sortHand(rawHand);

    // Build zero-trust opponents view
    const opponents: OpponentView[] = [];
    for (let s = 0; s < 4; s++) {
      if (s === targetSeat) continue;

      const seatInfo = options?.seatsInfo?.[s];
      const hasDoubled = matchState.doubledCards.some(
        (dc) => dc.doubledBySeat === s,
      );

      opponents.push({
        seat: s,
        remainingCardCount: matchState.hands[s]?.length ?? 0,
        isConnected: seatInfo?.isConnected ?? true,
        isDoublingAnnounced: hasDoubled,
        isBot: false, // Disguised! Flutter client NEVER receives isBot: true
        displayName: seatInfo?.displayName,
        avatarUrl: seatInfo?.avatarUrl,
        level: seatInfo?.level,
        coins: seatInfo?.coins,
        stats: seatInfo?.stats,
      });
    }

    // Determine eligible cards that target player can double right now
    const isDoublingPhase = matchState.currentPhase === 'DOUBLING_PHASE';
    const canDoubleCards: Card[] = [];

    if (isDoublingPhase) {
      for (const card of sortedHand) {
        // If Queen and contract has Queens
        if (
          card.rank === 'Q' &&
          matchState.activeContracts.includes('QUEENS')
        ) {
          const alreadyDoubled = matchState.doubledCards.some(
            (dc) => dc.suit === card.suit && dc.rank === 'Q',
          );
          if (!alreadyDoubled) {
            canDoubleCards.push(card);
          }
        }

        // If King of Hearts and contract has King of Hearts
        if (
          card.suit === 'HEARTS' &&
          card.rank === 'K' &&
          matchState.activeContracts.includes('KING_OF_HEARTS')
        ) {
          const alreadyDoubled = matchState.doubledCards.some(
            (dc) => dc.suit === 'HEARTS' && dc.rank === 'K',
          );
          if (!alreadyDoubled) {
            canDoubleCards.push(card);
          }
        }
      }
    }

    // Map doubled cards on table with declaredBySeat
    const doubledCardsOnTable = matchState.doubledCards.map((dc) => ({
      card: {
        id: dc.id,
        suit: dc.suit,
        rank: dc.rank,
        power: dc.power,
        isDoubled: true,
      },
      declaredBySeat: dc.doubledBySeat ?? 0,
    }));

    // Current trick cards
    const currentTrick = matchState.currentTrick.cards.map((tc) => ({
      seat: tc.seat,
      card: tc.card,
    }));

    // Last trick winner
    const lastTrick =
      matchState.trickHistory.length > 0
        ? matchState.trickHistory[matchState.trickHistory.length - 1]
        : null;
    const lastTrickWinner = lastTrick ? lastTrick.seat : null;

    const kingdom = matchState.kingdoms[matchState.currentKingdomIndex];

    return {
      roomId,
      gamePhase: matchState.currentPhase,
      kingdomIndex: (matchState.currentKingdomIndex ?? 0) + 1,
      kingdomOwnerSeat: kingdom ? kingdom.ownerSeat : 0,
      currentTurnSeat: matchState.currentTurnSeat,
      activeContracts: [...matchState.activeContracts],
      kingdomType: matchState.kingdomType,
      gameMode: matchState.gameMode,
      turnTimeLimit: options?.turnTimeLimit ?? 20,
      mySeat: targetSeat,
      myHand: sortedHand,
      opponents,
      doubledCardsOnTable,
      currentTrick,
      trixColumns: matchState.trixColumns,
      scores: {
        totalScores: { ...matchState.scores },
        roundScores: [...matchState.roundScores],
      },
      lastTrickWinner,
      isDoublingPhase,
      canDoubleCards,
      turnId: options?.turnId ?? 1,
      stateVersion: options?.stateVersion ?? 1,
      turnDeadlineTimestamp: options?.turnDeadlineTimestamp ?? null,
      roomSequence: options?.roomSequence ?? 0,
      serverTime: options?.serverTime ?? Date.now(),
      deadlineAt: options?.deadlineAt !== undefined ? options.deadlineAt : (options?.turnDeadlineTimestamp ?? null),
    };
  }
}
