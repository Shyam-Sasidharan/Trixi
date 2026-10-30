import { Card, Suit } from './card.types.js';
import { ContractType, GameMode, KingdomType } from './contract.types.js';

export type GamePhase =
  | 'KINGDOM_SELECTION'
  | 'CALL_OFF_CHECK'
  | 'DOUBLING_PHASE'
  | 'TRICK_PLAY'
  | 'TRICK_EVALUATING'
  | 'TRIX_PLAY'
  | 'CONTRACT_END'
  | 'KINGDOM_END'
  | 'GAME_OVER';

export interface TrickCard {
  seat: number;
  card: Card;
}

export interface Trick {
  leadSuit: Suit | null;
  cards: TrickCard[];
  winnerSeat?: number;
  winningCard?: Card;
}

export interface TrixColumn {
  minRank: number | null;
  maxRank: number | null;
  isOpen: boolean;
  cards: Card[];
}

export type TrixColumns = Record<Suit, TrixColumn>;

export interface CallOffResult {
  isCalledOff: boolean;
  reason?: 'KING_OF_HEARTS_SOLITARY' | 'KING_OF_HEARTS_WITH_ACE_ONLY' | 'TRIX_FOUR_TWOS' | 'TRIX_THREE_TWOS_AND_THREE';
  affectedSeat?: number;
}

export interface CollectedTrick {
  seat: number;
  trick: Trick;
}

export interface KingdomState {
  ownerSeat: number;
  kingdomNumber: number; // 1 to 4
  consumedContracts: ContractType[];
}

export interface MatchState {
  gameMode: GameMode;
  kingdomType: KingdomType;
  currentPhase: GamePhase;
  currentKingdomIndex: number; // 0 to 3
  kingdoms: KingdomState[];
  currentTurnSeat: number;
  activeContracts: ContractType[];
  hands: Record<number, Card[]>;
  doubledCards: Card[];
  currentTrick: Trick;
  trickHistory: CollectedTrick[];
  trixColumns: TrixColumns;
  trixFinishingOrder: number[];
  brokenSuits: Set<Suit>;
  scores: Record<number, number>;
  roundScores: Record<number, number>[];
}
