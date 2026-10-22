import { Card } from './types/card.types.js';
import { ContractType, GameMode } from './types/contract.types.js';
import { getTeamId } from './deck.js';

export class DoublingManager {
  /**
   * Checks whether a card is eligible for doubling:
   * Only Queens and the King of Hearts can be doubled, and only if the active contract is QUEENS or KING_OF_HEARTS.
   */
  static isCardEligibleForDoubling(card: Card, activeContracts: ContractType[]): boolean {
    if (card.rank === 'Q' && activeContracts.includes('QUEENS')) {
      return true;
    }
    if (card.rank === 'K' && card.suit === 'HEARTS' && activeContracts.includes('KING_OF_HEARTS')) {
      return true;
    }
    return false;
  }

  /**
   * Validates if a player holds this card and can double it.
   */
  static canPlayerDoubleCard(
    seat: number,
    card: Card,
    hand: Card[],
    activeContracts: ContractType[],
  ): boolean {
    if (!this.isCardEligibleForDoubling(card, activeContracts)) {
      return false;
    }
    return hand.some((c) => c.suit === card.suit && c.rank === card.rank && !c.isDoubled);
  }

  /**
   * Resolves the points for a captured doubled card.
   *
   * @param card The doubled card captured (Queen or King of Hearts)
   * @param doublerSeat The seat of the player who doubled the card
   * @param collectorSeat The seat of the player who won the trick containing the doubled card
   * @param trickLeadSeat The seat of the player who led the trick (caused collection)
   * @param gameMode 'SOLO' | 'TEAM'
   * @returns Points allocation mapped per seat
   */
  static resolveDoubledCard(
    card: Card,
    doublerSeat: number,
    collectorSeat: number,
    trickLeadSeat: number,
    gameMode: GameMode,
  ): Record<number, number> {
    const isQueen = card.rank === 'Q';
    const isKingOfHearts = card.rank === 'K' && card.suit === 'HEARTS';

    if (!isQueen && !isKingOfHearts) {
      return { 0: 0, 1: 0, 2: 0, 3: 0 };
    }

    const penalty = isQueen ? -50 : -150;
    const bonus = isQueen ? 25 : 75;

    const scores: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

    if (gameMode === 'SOLO') {
      if (collectorSeat === doublerSeat) {
        // Self-take: Doubler collected their own doubled card.
        // Penalty (-50 / -150) goes to doubler.
        // Bonus (+25 / +75) goes to the player who led the trick and forced them to take it,
        // or if doubler led the trick, the player who won it.
        scores[doublerSeat] += penalty;
        const rewardSeat = trickLeadSeat !== doublerSeat ? trickLeadSeat : collectorSeat;
        if (rewardSeat !== doublerSeat) {
          scores[rewardSeat] += bonus;
        }
      } else {
        // Opponent-take: Another player collected the doubled card.
        // Collector takes penalty (-50 / -150).
        // Doubler receives bonus (+25 / +75).
        scores[collectorSeat] += penalty;
        scores[doublerSeat] += bonus;
      }
    } else {
      // TEAM MODE (Team 1 = Seats 0, 2; Team 2 = Seats 1, 3)
      const doublerTeam = getTeamId(doublerSeat);
      const collectorTeam = getTeamId(collectorSeat);

      if (doublerTeam === collectorTeam) {
        // Doubler's team collected their own doubled card (either doubler or partner).
        // Doubler's team gets penalty (-50 / -150).
        // Opponent team gets bonus (+25 / +75).
        scores[collectorSeat] += penalty;

        // Give bonus to the opponent team (to the opponent who led or opponent seat 1/2)
        const opponentSeat = doublerTeam === 1 ? (trickLeadSeat % 2 === 1 ? trickLeadSeat : 1) : (trickLeadSeat % 2 === 0 ? trickLeadSeat : 0);
        scores[opponentSeat] += bonus;
      } else {
        // Opponent team collected the doubled card.
        // Collector's team receives penalty (-50 / -150).
        // Doubler's team receives bonus (+25 / +75).
        scores[collectorSeat] += penalty;
        scores[doublerSeat] += bonus;
      }
    }

    return scores;
  }
}
