import { Card, Suit } from '../types/card.types.js';
import { TrixColumns } from '../types/engine.types.js';

export class TrixContract {
  static createEmptyTrixColumns(): TrixColumns {
    return {
      DIAMONDS: { minRank: null, maxRank: null, isOpen: false, cards: [] },
      CLUBS: { minRank: null, maxRank: null, isOpen: false, cards: [] },
      HEARTS: { minRank: null, maxRank: null, isOpen: false, cards: [] },
      SPADES: { minRank: null, maxRank: null, isOpen: false, cards: [] },
    };
  }

  /**
   * Identifies all cards in a player's hand that are currently legal to play in Trix.
   */
  static getPlayableCards(hand: Card[], columns: TrixColumns): Card[] {
    const playable: Card[] = [];

    for (const card of hand) {
      const col = columns[card.suit];

      if (!col.isOpen) {
        // Only a Jack can open a suit column
        if (card.rank === 'J') {
          playable.push(card);
        }
      } else {
        // Column is open: can build up (maxRank + 1) or down (minRank - 1)
        if (col.maxRank !== null && card.power === col.maxRank + 1 && card.power <= 14) {
          playable.push(card);
        } else if (col.minRank !== null && card.power === col.minRank - 1 && card.power >= 2) {
          playable.push(card);
        }
      }
    }

    return playable;
  }

  /**
   * Validates whether a specific card is legal to play.
   */
  static validatePlay(card: Card, hand: Card[], columns: TrixColumns): { valid: boolean; reason?: string } {
    const ownsCard = hand.some((c) => c.suit === card.suit && c.rank === card.rank);
    if (!ownsCard) {
      return { valid: false, reason: 'Card not in player hand' };
    }

    const col = columns[card.suit];

    if (!col.isOpen) {
      if (card.rank !== 'J') {
        return { valid: false, reason: `Column for ${card.suit} must be opened with a Jack first` };
      }
      return { valid: true };
    }

    // Column is open: must be adjacent to high or low bound
    const isNextUp = col.maxRank !== null && card.power === col.maxRank + 1;
    const isNextDown = col.minRank !== null && card.power === col.minRank - 1;

    if (!isNextUp && !isNextDown) {
      return {
        valid: false,
        reason: `Card ${card.rank}${card.suit} is not adjacent to current bounds (min: ${col.minRank}, max: ${col.maxRank})`,
      };
    }

    return { valid: true };
  }

  /**
   * Validates if a player is allowed to pass.
   * A player is strictly FORBIDDEN to pass if they hold any playable card.
   */
  static validatePass(hand: Card[], columns: TrixColumns): { canPass: boolean; reason?: string } {
    const playable = this.getPlayableCards(hand, columns);
    if (playable.length > 0) {
      return {
        canPass: false,
        reason: `Player has ${playable.length} playable card(s) and cannot pass. Playable: ${playable.map((c) => `${c.rank}${c.suit}`).join(', ')}`,
      };
    }
    return { canPass: true };
  }

  /**
   * Places a card into the Trix layout and updates the column's bounds.
   */
  static applyCardPlay(card: Card, columns: TrixColumns): TrixColumns {
    const col = columns[card.suit];
    const newCol = { ...col, cards: [...col.cards, card] };

    if (!newCol.isOpen) {
      newCol.isOpen = true;
      newCol.minRank = card.power; // 11
      newCol.maxRank = card.power; // 11
    } else {
      if (card.power > (newCol.maxRank ?? 11)) {
        newCol.maxRank = card.power;
      } else if (card.power < (newCol.minRank ?? 11)) {
        newCol.minRank = card.power;
      }
    }

    return {
      ...columns,
      [card.suit]: newCol,
    };
  }

  /**
   * Calculates Trix finish scores:
   * 1st place: +200 pts
   * 2nd place: +150 pts
   * 3rd place: +100 pts
   * 4th place: +50 pts
   */
  static calculateTrixScores(finishingOrder: number[]): Record<number, number> {
    const scoreMap = [200, 150, 100, 50];
    const scores: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

    finishingOrder.forEach((seat, index) => {
      if (index < scoreMap.length) {
        scores[seat] = scoreMap[index];
      }
    });

    return scores;
  }
}
