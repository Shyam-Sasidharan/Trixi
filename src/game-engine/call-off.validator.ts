import { Card, Suit } from './types/card.types.js';
import { CallOffResult } from './types/engine.types.js';

export class CallOffValidator {
  /**
   * King of Hearts call-off condition:
   * 1. Player holds K♥ alone with no other Hearts.
   * 2. Player holds K♥ and A♥ together with no other Hearts.
   */
  static isKingOfHeartsCallOff(hand: Card[]): boolean {
    const hearts = hand.filter((c) => c.suit === 'HEARTS');
    const hasKingOfHearts = hearts.some((c) => c.rank === 'K');

    if (!hasKingOfHearts) {
      return false;
    }

    if (hearts.length === 1) {
      // King of Hearts is all alone with no other hearts
      return true;
    }

    if (hearts.length === 2 && hearts.some((c) => c.rank === 'A')) {
      // King of Hearts and its Ace are together only with no other hearts
      return true;
    }

    return false;
  }

  /**
   * Trix contract call-off condition:
   * 1. A player holds all four (2s) cards in their hand.
   * 2. A player holds three suits (2s) cards and the (3) of the fourth suit (with no 2 in that fourth suit).
   */
  static isTrixCallOff(hand: Card[]): boolean {
    const twos = hand.filter((c) => c.rank === 2);

    // Case 1: Four 2s
    if (twos.length === 4) {
      return true;
    }

    // Case 2: Three 2s and the 3 of the fourth suit
    if (twos.length === 3) {
      const allSuits: Suit[] = ['DIAMONDS', 'CLUBS', 'HEARTS', 'SPADES'];
      const suitsWithTwos = new Set(twos.map((c) => c.suit));
      const fourthSuit = allSuits.find((s) => !suitsWithTwos.has(s));

      if (fourthSuit) {
        const fourthSuitCards = hand.filter((c) => c.suit === fourthSuit);
        const hasThree = fourthSuitCards.some((c) => c.rank === 3);

        // "three suits (2s) cards and only the (3) of the fourth suit"
        // Either the 3 is the only card in the fourth suit, or holds the 3 in fourth suit without its 2
        if (hasThree) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks all 4 hands for King of Hearts call-off
   */
  static checkKingOfHeartsCallOff(hands: Record<number, Card[]>): CallOffResult {
    for (let seat = 0; seat < 4; seat++) {
      const hand = hands[seat] || [];
      const hearts = hand.filter((c) => c.suit === 'HEARTS');
      const hasKing = hearts.some((c) => c.rank === 'K');

      if (hasKing && hearts.length === 1) {
        return {
          isCalledOff: true,
          reason: 'KING_OF_HEARTS_SOLITARY',
          affectedSeat: seat,
        };
      }

      if (hasKing && hearts.length === 2 && hearts.some((c) => c.rank === 'A')) {
        return {
          isCalledOff: true,
          reason: 'KING_OF_HEARTS_WITH_ACE_ONLY',
          affectedSeat: seat,
        };
      }
    }

    return { isCalledOff: false };
  }

  /**
   * Checks all 4 hands for Trix call-off
   */
  static checkTrixCallOff(hands: Record<number, Card[]>): CallOffResult {
    for (let seat = 0; seat < 4; seat++) {
      const hand = hands[seat] || [];
      const twos = hand.filter((c) => c.rank === 2);

      if (twos.length === 4) {
        return {
          isCalledOff: true,
          reason: 'TRIX_FOUR_TWOS',
          affectedSeat: seat,
        };
      }

      if (twos.length === 3) {
        const allSuits: Suit[] = ['DIAMONDS', 'CLUBS', 'HEARTS', 'SPADES'];
        const suitsWithTwos = new Set(twos.map((c) => c.suit));
        const fourthSuit = allSuits.find((s) => !suitsWithTwos.has(s));

        if (fourthSuit) {
          const fourthSuitCards = hand.filter((c) => c.suit === fourthSuit);
          if (fourthSuitCards.some((c) => c.rank === 3)) {
            return {
              isCalledOff: true,
              reason: 'TRIX_THREE_TWOS_AND_THREE',
              affectedSeat: seat,
            };
          }
        }
      }
    }

    return { isCalledOff: false };
  }
}
