import { Injectable } from '@nestjs/common';
import { Card, Suit } from '../game-engine/types/card.types.js';
import {
  ALL_CONTRACTS,
  ContractType,
  KingdomType,
  NEGATIVE_CONTRACTS,
} from '../game-engine/types/contract.types.js';
import { MatchState, TrixColumns } from '../game-engine/types/engine.types.js';
import { TrickEngine } from '../game-engine/trick-engine.js';
import { TrixContract } from '../game-engine/contracts/trix.contract.js';

@Injectable()
export class BotBrainService {
  /**
   * Intelligently selects contract(s) when the bot is Kingdom Owner during KINGDOM_SELECTION.
   */
  public chooseContract(
    availableContracts: ContractType[],
    kingdomType: KingdomType,
    hand: Card[],
  ): ContractType[] {
    if (availableContracts.length === 0) {
      return ['TRIX'];
    }

    if (kingdomType === 'CRAZY_COMPLEX') {
      const canChooseTrix = availableContracts.includes('TRIX');
      const canChooseNegatives = NEGATIVE_CONTRACTS.every((c) =>
        availableContracts.includes(c),
      );

      if (canChooseTrix && canChooseNegatives) {
        const trixStrength = this.evaluateTrixStrength(hand);
        // If strong Trix hand, pick Trix; otherwise take all 4 negatives
        if (trixStrength >= 20) {
          return ['TRIX'];
        }
        return [...NEGATIVE_CONTRACTS];
      }

      if (canChooseTrix) return ['TRIX'];
      return [...NEGATIVE_CONTRACTS];
    }

    // FREE_MERCY mode
    const canChooseTrix = availableContracts.includes('TRIX');
    if (canChooseTrix) {
      const trixStrength = this.evaluateTrixStrength(hand);
      if (trixStrength >= 25) {
        return ['TRIX'];
      }
    }

    // Find the safest negative contract
    const negativeCandidates = availableContracts.filter((c) => c !== 'TRIX');
    if (negativeCandidates.length === 0) {
      return ['TRIX'];
    }

    let safestContract = negativeCandidates[0];
    let minDanger = Infinity;

    for (const contract of negativeCandidates) {
      const danger = this.evaluateContractDanger(contract, hand);
      if (danger < minDanger) {
        minDanger = danger;
        safestContract = contract;
      }
    }

    return [safestContract];
  }

  /**
   * Evaluates how favorable the hand is for playing TRIX.
   * High score means many Jacks, contiguous runs, and few blocked extremities.
   */
  private evaluateTrixStrength(hand: Card[]): number {
    let score = 0;
    const jacks = hand.filter((c) => c.rank === 'J');
    score += jacks.length * 15; // Each Jack is massive leverage

    // Reward cards close to Jacks (10, Q, 9, K)
    for (const card of hand) {
      if (card.power === 10 || card.power === 12) score += 3;
      if (card.power === 9 || card.power === 13) score += 2;
    }

    // Penalize low cards (2, 3) without connected cards
    for (const suit of ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'] as Suit[]) {
      const suitCards = hand.filter((c) => c.suit === suit);
      const hasJack = suitCards.some((c) => c.rank === 'J');
      if (hasJack) {
        score += suitCards.length * 2;
      }
    }

    return score;
  }

  /**
   * Evaluates the danger of taking penalties in a specific negative contract.
   * Lower score = safer.
   */
  private evaluateContractDanger(contract: ContractType, hand: Card[]): number {
    // Void suit advantage: being void in suits allows early sloughing of danger cards
    const voidCount = (['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'] as Suit[]).filter(
      (s) => !hand.some((c) => c.suit === s),
    ).length;

    let danger = 50;
    switch (contract) {
      case 'KING_OF_HEARTS': {
        const hasKoh = hand.some((c) => c.suit === 'HEARTS' && c.rank === 'K');
        if (!hasKoh) return 0; // Extremely safe if bot doesn't hold K♥
        const heartsCount = hand.filter((c) => c.suit === 'HEARTS').length;
        // Holding K♥ with few hearts is suicidal; with 5+ hearts it's somewhat protected
        danger = heartsCount >= 5 ? 30 : 80;
        break;
      }

      case 'QUEENS': {
        const queens = hand.filter((c) => c.rank === 'Q');
        if (queens.length === 0) return Math.max(0, 5 - voidCount * 2);
        danger = 0;
        for (const q of queens) {
          const lowerCount = hand.filter(
            (c) => c.suit === q.suit && c.power < 12,
          ).length;
          danger += lowerCount >= 3 ? 15 : 35;
        }
        break;
      }

      case 'DIAMONDS': {
        const diamonds = hand.filter((c) => c.suit === 'DIAMONDS');
        const highDiamonds = diamonds.filter((c) => c.power >= 12);
        danger = diamonds.length * 3 + highDiamonds.length * 8;
        break;
      }

      case 'HANDS': {
        const highCards = hand.filter((c) => c.power >= 11);
        danger = highCards.length * 4;
        break;
      }

      default:
        danger = 50;
    }

    return Math.max(0, danger - voidCount * 8);
  }

  /**
   * Computes the single best legal card to play for the bot (alias for decideCardToPlay).
   */
  public pickBestCard(
    botHand: Card[],
    gameState: MatchState,
    botSeat: number,
  ): Card {
    return this.decideCardToPlay(botHand, gameState, botSeat);
  }

  /**
   * Decides which eligible cards to double during DOUBLING_PHASE.
   * Queens: Double only if backed by 3+ lower cards of that suit.
   * King of Hearts: Double only if holding 4+ other Hearts.
   */
  public decideDoubling(botHand: Card[], activeContracts: ContractType[]): Card[] {
    const toDouble: Card[] = [];

    // Evaluate Queens
    if (activeContracts.includes('QUEENS')) {
      const queens = botHand.filter((c) => c.rank === 'Q' && !c.isDoubled);
      for (const queen of queens) {
        const lowerCount = botHand.filter(
          (c) => c.suit === queen.suit && c.power < 12,
        ).length;
        if (lowerCount >= 3) {
          toDouble.push(queen);
        }
      }
    }

    // Evaluate King of Hearts
    if (activeContracts.includes('KING_OF_HEARTS')) {
      const koh = botHand.find((c) => c.suit === 'HEARTS' && c.rank === 'K' && !c.isDoubled);
      if (koh) {
        const otherHearts = botHand.filter(
          (c) => c.suit === 'HEARTS' && c.rank !== 'K',
        ).length;
        if (otherHearts >= 4) {
          toDouble.push(koh);
        }
      }
    }

    return toDouble;
  }

  /**
   * Computes the single best legal card to play for the bot.
   */
  public decideCardToPlay(
    botHand: Card[],
    gameState: MatchState,
    botSeat: number,
  ): Card {
    if (gameState.currentPhase === 'TRIX_PLAY') {
      return this.decideTrixCard(botHand, gameState.trixColumns);
    }

    if (gameState.currentPhase === 'TRICK_PLAY') {
      return this.decideTrickCard(botHand, gameState, botSeat);
    }

    return botHand[0];
  }

  /**
   * TRIX heuristic:
   * 1. Prioritize opening new columns with Jacks (picking the one that unblocks the most cards).
   * 2. Next, play cards that unblock the bot's own hand (e.g., Q when holding K).
   * 3. Otherwise play closest legal adjacent card.
   */
  private decideTrixCard(botHand: Card[], columns: TrixColumns): Card {
    const legalCards = TrixContract.getPlayableCards(botHand, columns);
    if (legalCards.length === 0) {
      return botHand[0];
    }
    if (legalCards.length === 1) {
      return legalCards[0];
    }

    // 1. Prioritize opening new columns with Jacks
    const playableJacks = legalCards.filter((c) => c.rank === 'J');
    if (playableJacks.length > 0) {
      // Pick the Jack that unblocks the highest number of cards in bot's hand
      let bestJack = playableJacks[0];
      let maxFollowUps = -1;

      for (const jack of playableJacks) {
        const followUps = botHand.filter(
          (c) => c.suit === jack.suit && c.rank !== 'J',
        ).length;
        if (followUps > maxFollowUps) {
          maxFollowUps = followUps;
          bestJack = jack;
        }
      }
      return bestJack;
    }

    // 2. Play cards that unblock the bot's own hand
    let bestCard = legalCards[0];
    let maxUnblocked = -1;

    for (const card of legalCards) {
      let unblocks = 0;
      // Does playing this card unblock immediate neighbors in bot's hand?
      const col = columns[card.suit];
      if (col.isOpen) {
        const hasNextUp = botHand.some(
          (c) => c.suit === card.suit && c.power === card.power + 1,
        );
        const hasNextDown = botHand.some(
          (c) => c.suit === card.suit && c.power === card.power - 1,
        );
        if (hasNextUp) unblocks += 2;
        if (hasNextDown) unblocks += 2;
      }

      if (unblocks > maxUnblocked) {
        maxUnblocked = unblocks;
        bestCard = card;
      }
    }

    if (maxUnblocked > 0) {
      return bestCard;
    }

    // 3. Otherwise play closest legal adjacent card (prefer lower power cards)
    return [...legalCards].sort((a, b) => a.power - b.power)[0];
  }

  /**
   * TRICK_PLAY heuristic for negative contracts (Queens, King of Hearts, Diamonds, Hands):
   */
  private decideTrickCard(
    botHand: Card[],
    gameState: MatchState,
    botSeat: number,
  ): Card {
    const legalCards = botHand.filter(
      (c) =>
        TrickEngine.validatePlay(
          botHand,
          c,
          gameState.currentTrick,
          gameState.brokenSuits,
          gameState.activeContracts,
          gameState.kingdomType,
        ).valid,
    );

    if (legalCards.length === 0) return botHand[0];
    if (legalCards.length === 1) return legalCards[0];

    const isLeading = gameState.currentTrick.cards.length === 0;

    if (isLeading) {
      return this.decideLeadCard(legalCards, gameState.activeContracts);
    }

    return this.decideFollowCard(
      botHand,
      legalCards,
      gameState.currentTrick.leadSuit!,
      gameState.currentTrick.cards,
      gameState.activeContracts,
    );
  }

  /**
   * Leading card heuristic:
   * - Avoid leading Hearts when King of Hearts is active unless forced.
   * - Avoid leading Diamonds when Diamonds is active unless forced.
   * - Play the lowest power card to avoid taking tricks.
   */
  private decideLeadCard(
    legalCards: Card[],
    activeContracts: ContractType[],
  ): Card {
    let pool = [...legalCards];

    // Filter out Hearts if King of Hearts active and non-Hearts exist
    if (activeContracts.includes('KING_OF_HEARTS')) {
      const nonHearts = pool.filter((c) => c.suit !== 'HEARTS');
      if (nonHearts.length > 0) pool = nonHearts;
    }

    // Filter out Diamonds if Diamonds active and non-Diamonds exist
    if (activeContracts.includes('DIAMONDS')) {
      const nonDiamonds = pool.filter((c) => c.suit !== 'DIAMONDS');
      if (nonDiamonds.length > 0) pool = nonDiamonds;
    }

    // Lead lowest card to duck
    return pool.sort((a, b) => a.power - b.power)[0];
  }

  /**
   * Following card heuristic:
   */
  private decideFollowCard(
    fullHand: Card[],
    legalCards: Card[],
    leadSuit: Suit,
    trickCards: Array<{ seat: number; card: Card }>,
    activeContracts: ContractType[],
  ): Card {
    const isVoidInLead = !fullHand.some((c) => c.suit === leadSuit);

    // ==========================================
    // CASE 1: VOID IN LED SUIT (SLOUGHING / DISCARDING)
    // ==========================================
    if (isVoidInLead) {
      // 1. King of Hearts contract: Dump K♥ immediately if held!
      if (activeContracts.includes('KING_OF_HEARTS')) {
        const koh = legalCards.find(
          (c) => c.suit === 'HEARTS' && c.rank === 'K',
        );
        if (koh) return koh;
      }

      // 2. Queens contract: Dump any Queen immediately!
      if (activeContracts.includes('QUEENS')) {
        const queens = legalCards.filter((c) => c.rank === 'Q');
        if (queens.length > 0) {
          // If doubled Queen exists, dump it first
          const doubledQueen = queens.find((q) => q.isDoubled);
          return doubledQueen || queens[0];
        }
      }

      // 3. Diamonds contract: Dump high Diamonds (A♦, K♦, Q♦)
      if (activeContracts.includes('DIAMONDS')) {
        const highDiamonds = legalCards
          .filter((c) => c.suit === 'DIAMONDS' && c.power >= 12)
          .sort((a, b) => b.power - a.power);
        if (highDiamonds.length > 0) return highDiamonds[0];
      }

      // 4. Otherwise dump highest power card from another suit
      return [...legalCards].sort((a, b) => b.power - a.power)[0];
    }

    // ==========================================
    // CASE 2: FOLLOWING SUIT (HOLD CARDS OF LEAD SUIT)
    // ==========================================
    // Find current highest power card of lead suit played in this trick
    const leadSuitTrickCards = trickCards.filter(
      (tc) => tc.card.suit === leadSuit,
    );
    const trickHighestPower = Math.max(
      ...leadSuitTrickCards.map((tc) => tc.card.power),
    );

    // Cards lower than the trick's highest card (safe ducking cards)
    const safeCards = legalCards.filter((c) => c.power < trickHighestPower);

    if (safeCards.length > 0) {
      // Queens contract: avoid playing Queen even if safe, unless necessary
      if (activeContracts.includes('QUEENS')) {
        const nonQueenSafe = safeCards.filter((c) => c.rank !== 'Q');
        if (nonQueenSafe.length > 0) {
          // Play the highest card lower than the current trick's highest card
          return nonQueenSafe.sort((a, b) => b.power - a.power)[0];
        }
      }

      // Play the highest card lower than current highest (duck with maximum safe power)
      return safeCards.sort((a, b) => b.power - a.power)[0];
    }

    // Forced to win the trick: play lowest legal card to minimize damage
    return [...legalCards].sort((a, b) => a.power - b.power)[0];
  }

  /**
   * Validates if a bot can pass in TRIX.
   * Strictly true ONLY if no playable cards exist.
   */
  public decideTrixPass(botHand: Card[], columns: TrixColumns): boolean {
    const playable = TrixContract.getPlayableCards(botHand, columns);
    return playable.length === 0;
  }
}
