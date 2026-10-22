import { Card, Rank, RANK_POWERS, Suit } from './types/card.types.js';

export const ALL_SUITS: readonly Suit[] = [
  'DIAMONDS',
  'CLUBS',
  'HEARTS',
  'SPADES',
] as const;

export const ALL_RANKS: readonly Rank[] = [
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  'J',
  'Q',
  'K',
  'A',
] as const;

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      deck.push({
        id: `${suit}_${rank}`,
        suit,
        rank,
        power: RANK_POWERS[rank],
      });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[], rng: () => number = Math.random): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  return shuffled;
}

export function dealCards(shuffledDeck: Card[]): Record<number, Card[]> {
  if (shuffledDeck.length !== 52) {
    throw new Error(`Cannot deal a deck with ${shuffledDeck.length} cards, exactly 52 required.`);
  }

  const hands: Record<number, Card[]> = {
    0: [],
    1: [],
    2: [],
    3: [],
  };

  for (let i = 0; i < 52; i++) {
    const seat = i % 4;
    hands[seat].push({ ...shuffledDeck[i] });
  }

  for (let seat = 0; seat < 4; seat++) {
    hands[seat] = sortHand(hands[seat]);
  }

  return hands;
}

export function findSevenOfHeartsOwner(hands: Record<number, Card[]> | Card[][]): number {
  const entries = Array.isArray(hands)
    ? hands.map((h, idx) => [idx, h] as const)
    : Object.entries(hands).map(([k, v]) => [Number(k), v] as const);

  for (const [seat, cards] of entries) {
    if (cards.some((c) => c.suit === 'HEARTS' && c.rank === 7)) {
      return seat;
    }
  }

  throw new Error('Seven of Hearts (7♥) not found in any dealt hand');
}

/**
 * Returns the next player to the right (counter-clockwise):
 * Seat 0 -> Seat 3 -> Seat 2 -> Seat 1 -> Seat 0
 */
export function getNextSeat(seat: number): number {
  return (seat + 3) % 4;
}

/**
 * Returns the next teammate for team mode:
 * Team 1: Seats 0 and 2
 * Team 2: Seats 1 and 3
 */
export function getTeammateSeat(seat: number): number {
  return (seat + 2) % 4;
}

export function getTeamId(seat: number): number {
  return seat % 2 === 0 ? 1 : 2;
}

/**
 * Sorts hand by standard Trix suit ordering: Diamonds, Clubs, Hearts, Spades,
 * and within each suit by power descending (A -> K -> Q -> ... -> 2).
 */
export function sortHand(hand: Card[]): Card[] {
  const suitOrder: Record<Suit, number> = {
    DIAMONDS: 0,
    CLUBS: 1,
    HEARTS: 2,
    SPADES: 3,
  };

  return [...hand].sort((a, b) => {
    if (a.suit !== b.suit) {
      return suitOrder[a.suit] - suitOrder[b.suit];
    }
    return b.power - a.power;
  });
}
