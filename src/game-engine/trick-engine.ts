import { Card, Suit } from './types/card.types.js';
import { ContractType, GameMode, KingdomType } from './types/contract.types.js';
import { CollectedTrick, Trick } from './types/engine.types.js';
import { DoublingManager } from './doubling.js';

export class TrickEngine {
  /**
   * Validates whether a card can be legally played to the current trick.
   */
  static validatePlay(
    hand: Card[],
    card: Card,
    currentTrick: Trick,
    brokenSuits: Set<Suit>,
    activeContracts: ContractType[],
    kingdomType: KingdomType,
  ): { valid: boolean; reason?: string } {
    // 1. Must own the card
    const hasCard = hand.some((c) => c.suit === card.suit && c.rank === card.rank);
    if (!hasCard) {
      return { valid: false, reason: 'Card is not in player hand' };
    }

    const isLeading = currentTrick.cards.length === 0;

    if (isLeading) {
      // Leading rules:
      const allFourNegatives =
        activeContracts.includes('QUEENS') &&
        activeContracts.includes('KING_OF_HEARTS') &&
        activeContracts.includes('DIAMONDS') &&
        activeContracts.includes('HANDS');

      // Diamond leading rule:
      if (card.suit === 'DIAMONDS') {
        const isFreeMercyWithDiamond =
          kingdomType === 'FREE_MERCY' &&
          activeContracts.includes('DIAMONDS') &&
          !allFourNegatives;

        if (isFreeMercyWithDiamond && !brokenSuits.has('DIAMONDS')) {
          const onlyDiamonds = hand.every((c) => c.suit === 'DIAMONDS');
          if (!onlyDiamonds) {
            return {
              valid: false,
              reason: 'Cannot lead Diamonds until broken, unless hand holds only Diamonds',
            };
          }
        }
      }

      // Hearts leading rule (when King of Hearts contract is active):
      if (card.suit === 'HEARTS' && activeContracts.includes('KING_OF_HEARTS')) {
        if (!brokenSuits.has('HEARTS')) {
          const onlyHearts = hand.every((c) => c.suit === 'HEARTS');
          if (!onlyHearts) {
            return {
              valid: false,
              reason: 'Cannot lead Hearts until broken, unless hand holds only Hearts',
            };
          }
        }
      }

      return { valid: true };
    }

    // Following rules:
    const leadSuit = currentTrick.leadSuit;
    if (!leadSuit) {
      return { valid: false, reason: 'Invalid trick state: missing lead suit' };
    }

    if (card.suit !== leadSuit) {
      const hasLeadSuit = hand.some((c) => c.suit === leadSuit);
      if (hasLeadSuit) {
        return {
          valid: false,
          reason: `Must follow suit (${leadSuit}) if you hold cards of that suit`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Determines the winner of a completed 4-card trick.
   * Highest power card of the lead suit wins (no trump suit).
   */
  static determineWinner(trick: Trick): { winnerSeat: number; winningCard: Card } {
    if (trick.cards.length !== 4 || !trick.leadSuit) {
      throw new Error('Trick must have 4 cards and a lead suit to determine winner');
    }

    const leadSuit = trick.leadSuit;
    let winningCard = trick.cards[0].card;
    let winnerSeat = trick.cards[0].seat;

    for (let i = 1; i < trick.cards.length; i++) {
      const { seat, card } = trick.cards[i];
      if (card.suit === leadSuit && card.power > winningCard.power) {
        winningCard = card;
        winnerSeat = seat;
      }
    }

    return { winnerSeat, winningCard };
  }

  /**
   * Checks if any single player captured all 13 Diamonds.
   */
  static check13DiamondSweep(collectedTricks: CollectedTrick[]): {
    isSweep: boolean;
    sweeperSeat?: number;
  } {
    const diamondCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

    for (const { seat, trick } of collectedTricks) {
      for (const { card } of trick.cards) {
        if (card.suit === 'DIAMONDS') {
          diamondCounts[seat] = (diamondCounts[seat] || 0) + 1;
        }
      }
    }

    for (let seat = 0; seat < 4; seat++) {
      if (diamondCounts[seat] === 13) {
        return { isSweep: true, sweeperSeat: seat };
      }
    }

    return { isSweep: false };
  }

  /**
   * Calculates scores for all 4 players based on captured cards and active contracts.
   */
  static calculateNegativeScores(
    collectedTricks: CollectedTrick[],
    activeContracts: ContractType[],
    gameMode: GameMode,
    kingdomType: KingdomType,
  ): {
    scores: Record<number, number>;
    isSweepRollback: boolean;
    sweeperSeat?: number;
  } {
    const sweep = this.check13DiamondSweep(collectedTricks);

    const hasQueens = activeContracts.includes('QUEENS');
    const hasKingOfHearts = activeContracts.includes('KING_OF_HEARTS');
    const hasDiamonds = activeContracts.includes('DIAMONDS');
    const hasHands = activeContracts.includes('HANDS');

    const allFourNegatives = hasQueens && hasKingOfHearts && hasDiamonds && hasHands;

    // Handle 13-Diamond sweep rule:
    if (sweep.isSweep && hasDiamonds) {
      if (kingdomType === 'CRAZY_COMPLEX' || allFourNegatives) {
        // In Crazy Complex or all 4 negatives: Cancel ALL contract scores for this deal!
        return {
          scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
          isSweepRollback: true,
          sweeperSeat: sweep.sweeperSeat,
        };
      }
    }

    const scores: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

    for (const { seat: collectorSeat, trick } of collectedTricks) {
      const trickLeadSeat = trick.cards[0].seat;

      // Hands contract: -15 per trick collected
      if (hasHands) {
        scores[collectorSeat] -= 15;
      }

      for (const { card } of trick.cards) {
        // Diamonds contract: -10 each (unless cancelled by single diamond sweep in Free Mercy)
        if (hasDiamonds && card.suit === 'DIAMONDS') {
          if (!sweep.isSweep) {
            scores[collectorSeat] -= 10;
          }
        }

        // Queens contract: -25 each (or doubled)
        if (hasQueens && card.rank === 'Q') {
          if (card.isDoubled && card.doubledBySeat !== undefined) {
            const doublingPoints = DoublingManager.resolveDoubledCard(
              card,
              card.doubledBySeat,
              collectorSeat,
              trickLeadSeat,
              gameMode,
            );
            for (let s = 0; s < 4; s++) {
              scores[s] += doublingPoints[s];
            }
          } else {
            scores[collectorSeat] -= 25;
          }
        }

        // King of Hearts contract: -75 (or doubled)
        if (hasKingOfHearts && card.suit === 'HEARTS' && card.rank === 'K') {
          if (card.isDoubled && card.doubledBySeat !== undefined) {
            const doublingPoints = DoublingManager.resolveDoubledCard(
              card,
              card.doubledBySeat,
              collectorSeat,
              trickLeadSeat,
              gameMode,
            );
            for (let s = 0; s < 4; s++) {
              scores[s] += doublingPoints[s];
            }
          } else {
            scores[collectorSeat] -= 75;
          }
        }
      }
    }

    return {
      scores,
      isSweepRollback: sweep.isSweep,
      sweeperSeat: sweep.sweeperSeat,
    };
  }
}
