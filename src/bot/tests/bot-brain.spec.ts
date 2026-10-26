import { describe, it, expect, beforeEach } from 'vitest';
import { BotBrainService } from '../bot-brain.service.js';
import { Card } from '../../game-engine/types/card.types.js';
import { MatchState } from '../../game-engine/types/engine.types.js';
import { TrixContract } from '../../game-engine/contracts/trix.contract.js';

describe('BotBrainService (Heuristic Decision Engine)', () => {
  let brain: BotBrainService;

  beforeEach(() => {
    brain = new BotBrainService();
  });

  describe('Queens Heuristic', () => {
    it('should discard Queen when void in the led suit', () => {
      const botHand: Card[] = [
        { id: '1', suit: 'HEARTS', rank: 'Q', power: 12 },
        { id: '2', suit: 'CLUBS', rank: 5, power: 5 },
        { id: '3', suit: 'DIAMONDS', rank: 4, power: 4 },
      ];

      const mockState: Partial<MatchState> = {
        currentPhase: 'TRICK_PLAY',
        activeContracts: ['QUEENS'],
        kingdomType: 'FREE_MERCY',
        currentTrick: {
          leadSuit: 'SPADES',
          cards: [
            { seat: 0, card: { id: 's1', suit: 'SPADES', rank: 10, power: 10 } },
          ],
        },
        brokenSuits: new Set(['SPADES', 'HEARTS', 'CLUBS', 'DIAMONDS']),
      };

      const chosen = brain.decideCardToPlay(botHand, mockState as MatchState, 1);
      expect(chosen.suit).toBe('HEARTS');
      expect(chosen.rank).toBe('Q');
    });

    it('should play highest safe card lower than trick high when following suit', () => {
      const botHand: Card[] = [
        { id: '1', suit: 'SPADES', rank: 9, power: 9 },
        { id: '2', suit: 'SPADES', rank: 7, power: 7 },
        { id: '3', suit: 'SPADES', rank: 'K', power: 13 },
      ];

      const mockState: Partial<MatchState> = {
        currentPhase: 'TRICK_PLAY',
        activeContracts: ['QUEENS'],
        kingdomType: 'FREE_MERCY',
        currentTrick: {
          leadSuit: 'SPADES',
          cards: [
            { seat: 0, card: { id: 's1', suit: 'SPADES', rank: 10, power: 10 } },
          ],
        },
        brokenSuits: new Set(['SPADES']),
      };

      // Trick high is 10. Safe cards are 9 and 7. Bot should play highest safe card (9).
      const chosen = brain.decideCardToPlay(botHand, mockState as MatchState, 1);
      expect(chosen.rank).toBe(9);
      expect(chosen.power).toBe(9);
    });

    it('should play lowest legal card when forced to win the trick', () => {
      const botHand: Card[] = [
        { id: '1', suit: 'SPADES', rank: 'J', power: 11 },
        { id: '2', suit: 'SPADES', rank: 'A', power: 14 },
      ];

      const mockState: Partial<MatchState> = {
        currentPhase: 'TRICK_PLAY',
        activeContracts: ['QUEENS'],
        kingdomType: 'FREE_MERCY',
        currentTrick: {
          leadSuit: 'SPADES',
          cards: [
            { seat: 0, card: { id: 's1', suit: 'SPADES', rank: 8, power: 8 } },
          ],
        },
        brokenSuits: new Set(['SPADES']),
      };

      // Both J(11) and A(14) are above 8. Bot is forced to win; should play lowest (J).
      const chosen = brain.decideCardToPlay(botHand, mockState as MatchState, 1);
      expect(chosen.rank).toBe('J');
    });
  });

  describe('King of Hearts Heuristic', () => {
    it('should avoid leading Hearts when other suits are held', () => {
      const botHand: Card[] = [
        { id: '1', suit: 'HEARTS', rank: 4, power: 4 },
        { id: '2', suit: 'DIAMONDS', rank: 8, power: 8 },
        { id: '3', suit: 'CLUBS', rank: 5, power: 5 },
      ];

      const mockState: Partial<MatchState> = {
        currentPhase: 'TRICK_PLAY',
        activeContracts: ['KING_OF_HEARTS'],
        kingdomType: 'FREE_MERCY',
        currentTrick: {
          leadSuit: null,
          cards: [],
        },
        brokenSuits: new Set(['HEARTS', 'DIAMONDS', 'CLUBS']),
      };

      const chosen = brain.decideCardToPlay(botHand, mockState as MatchState, 0);
      expect(chosen.suit).not.toBe('HEARTS');
    });

    it('should dump K♥ immediately when void in the led suit', () => {
      const botHand: Card[] = [
        { id: '1', suit: 'HEARTS', rank: 'K', power: 13 },
        { id: '2', suit: 'DIAMONDS', rank: 3, power: 3 },
        { id: '3', suit: 'SPADES', rank: 6, power: 6 },
      ];

      const mockState: Partial<MatchState> = {
        currentPhase: 'TRICK_PLAY',
        activeContracts: ['KING_OF_HEARTS'],
        kingdomType: 'FREE_MERCY',
        currentTrick: {
          leadSuit: 'CLUBS',
          cards: [
            { seat: 0, card: { id: 'c1', suit: 'CLUBS', rank: 10, power: 10 } },
          ],
        },
        brokenSuits: new Set(['CLUBS', 'HEARTS', 'DIAMONDS', 'SPADES']),
      };

      const chosen = brain.decideCardToPlay(botHand, mockState as MatchState, 1);
      expect(chosen.suit).toBe('HEARTS');
      expect(chosen.rank).toBe('K');
    });
  });

  describe('Trix Heuristic', () => {
    it('should prioritize Jacks over normal step ladder cards', () => {
      const botHand: Card[] = [
        { id: '1', suit: 'SPADES', rank: 'J', power: 11 },
        { id: '2', suit: 'DIAMONDS', rank: 9, power: 9 },
        { id: '3', suit: 'DIAMONDS', rank: 'K', power: 13 },
      ];

      const columns = TrixContract.createEmptyTrixColumns();
      // Diamonds is open between 10 and 12
      columns.DIAMONDS.isOpen = true;
      columns.DIAMONDS.minRank = 10;
      columns.DIAMONDS.maxRank = 12;

      // Spades is closed
      columns.SPADES.isOpen = false;

      const mockState: Partial<MatchState> = {
        currentPhase: 'TRIX_PLAY',
        activeContracts: ['TRIX'],
        trixColumns: columns,
      };

      // Both J♠ (to open Spades) and 9♦ / K♦ are legal. Bot must prioritize Jack of Spades.
      const chosen = brain.decideCardToPlay(botHand, mockState as MatchState, 0);
      expect(chosen.rank).toBe('J');
      expect(chosen.suit).toBe('SPADES');
    });

    it('should correctly allow pass only when no legal cards can be played', () => {
      const columns = TrixContract.createEmptyTrixColumns();
      // Diamonds open with J only
      columns.DIAMONDS.isOpen = true;
      columns.DIAMONDS.minRank = 11;
      columns.DIAMONDS.maxRank = 11;

      // Bot holds 5 of Clubs, 2 of Hearts, 3 of Spades (none can be played)
      const handWithoutMoves: Card[] = [
        { id: '1', suit: 'CLUBS', rank: 5, power: 5 },
        { id: '2', suit: 'HEARTS', rank: 2, power: 2 },
      ];

      expect(brain.decideTrixPass(handWithoutMoves, columns)).toBe(true);

      // Bot holds 10 of Diamonds (can play on 11)
      const handWithMove: Card[] = [
        ...handWithoutMoves,
        { id: '3', suit: 'DIAMONDS', rank: 10, power: 10 },
      ];

      expect(brain.decideTrixPass(handWithMove, columns)).toBe(false);
    });
  });

  describe('Doubling Heuristic', () => {
    it('should double a Queen only when supported by 3+ lower cards of same suit', () => {
      // Well backed: Q♥ with 10♥, 7♥, 2♥ (3 lower cards)
      const protectedQueenHand: Card[] = [
        { id: '1', suit: 'HEARTS', rank: 'Q', power: 12 },
        { id: '2', suit: 'HEARTS', rank: 10, power: 10 },
        { id: '3', suit: 'HEARTS', rank: 7, power: 7 },
        { id: '4', suit: 'HEARTS', rank: 2, power: 2 },
      ];

      const toDouble = brain.decideDoubling(protectedQueenHand, ['QUEENS']);
      expect(toDouble.length).toBe(1);
      expect(toDouble[0].rank).toBe('Q');

      // Exposed: Q♥ with only 8♥ (1 lower card)
      const exposedQueenHand: Card[] = [
        { id: '1', suit: 'HEARTS', rank: 'Q', power: 12 },
        { id: '2', suit: 'HEARTS', rank: 8, power: 8 },
      ];

      const toDoubleExposed = brain.decideDoubling(exposedQueenHand, ['QUEENS']);
      expect(toDoubleExposed.length).toBe(0);
    });

    it('should double King of Hearts only when protected by 4+ other Hearts', () => {
      // Well protected: K♥ + 4 other Hearts (5 Hearts total)
      const protectedKohHand: Card[] = [
        { id: '1', suit: 'HEARTS', rank: 'K', power: 13 },
        { id: '2', suit: 'HEARTS', rank: 9, power: 9 },
        { id: '3', suit: 'HEARTS', rank: 7, power: 7 },
        { id: '4', suit: 'HEARTS', rank: 4, power: 4 },
        { id: '5', suit: 'HEARTS', rank: 2, power: 2 },
      ];

      const toDouble = brain.decideDoubling(protectedKohHand, ['KING_OF_HEARTS']);
      expect(toDouble.length).toBe(1);
      expect(toDouble[0].rank).toBe('K');

      // Risky: K♥ + 2 other Hearts
      const riskyKohHand: Card[] = [
        { id: '1', suit: 'HEARTS', rank: 'K', power: 13 },
        { id: '2', suit: 'HEARTS', rank: 8, power: 8 },
        { id: '3', suit: 'HEARTS', rank: 3, power: 3 },
      ];

      const toDoubleRisky = brain.decideDoubling(riskyKohHand, ['KING_OF_HEARTS']);
      expect(toDoubleRisky.length).toBe(0);
    });
  });

  describe('Contract Selection Heuristic', () => {
    it('should select Trix when holding strong Jacks and runs', () => {
      const strongTrixHand: Card[] = [
        { id: '1', suit: 'SPADES', rank: 'J', power: 11 },
        { id: '2', suit: 'HEARTS', rank: 'J', power: 11 },
        { id: '3', suit: 'DIAMONDS', rank: 'J', power: 11 },
        { id: '4', suit: 'SPADES', rank: 'Q', power: 12 },
        { id: '5', suit: 'SPADES', rank: 'K', power: 13 },
        { id: '6', suit: 'SPADES', rank: 10, power: 10 },
      ];

      const chosen = brain.chooseContract(
        ['QUEENS', 'KING_OF_HEARTS', 'DIAMONDS', 'HANDS', 'TRIX'],
        'FREE_MERCY',
        strongTrixHand,
      );

      expect(chosen).toEqual(['TRIX']);
    });

    it('should select all 4 negative contracts in Crazy Complex if hand is not suited for Trix', () => {
      const poorTrixHand: Card[] = [
        { id: '1', suit: 'SPADES', rank: 2, power: 2 },
        { id: '2', suit: 'HEARTS', rank: 3, power: 3 },
        { id: '3', suit: 'CLUBS', rank: 4, power: 4 },
      ];

      const chosen = brain.chooseContract(
        ['QUEENS', 'KING_OF_HEARTS', 'DIAMONDS', 'HANDS', 'TRIX'],
        'CRAZY_COMPLEX',
        poorTrixHand,
      );

      expect(chosen).toEqual(['QUEENS', 'KING_OF_HEARTS', 'DIAMONDS', 'HANDS']);
    });
  });
});
