import { describe, expect, it } from 'vitest';
import { TrickEngine } from '../trick-engine.js';
import { Card, Suit } from '../types/card.types.js';
import { CollectedTrick, Trick } from '../types/engine.types.js';

describe('TrickEngine', () => {
  const makeCard = (suit: Suit, rank: any, power: number): Card => ({
    id: `${suit}_${rank}`,
    suit,
    rank,
    power,
  });

  describe('Follow-Suit Validation', () => {
    it('should strictly reject off-suit card when player holds led suit', () => {
      const hand: Card[] = [
        makeCard('SPADES', 10, 10),
        makeCard('HEARTS', 'A', 14),
        makeCard('DIAMONDS', 5, 5),
      ];

      const currentTrick: Trick = {
        leadSuit: 'SPADES',
        cards: [{ seat: 0, card: makeCard('SPADES', 7, 7) }],
      };

      const brokenSuits = new Set<Suit>(['SPADES']);

      // Trying to play Heart when holding Spades
      const invalidPlay = TrickEngine.validatePlay(
        hand,
        makeCard('HEARTS', 'A', 14),
        currentTrick,
        brokenSuits,
        ['HANDS'],
        'FREE_MERCY',
      );

      expect(invalidPlay.valid).toBe(false);
      expect(invalidPlay.reason).toContain('Must follow suit');

      // Playing Spades should be valid
      const validPlay = TrickEngine.validatePlay(
        hand,
        makeCard('SPADES', 10, 10),
        currentTrick,
        brokenSuits,
        ['HANDS'],
        'FREE_MERCY',
      );

      expect(validPlay.valid).toBe(true);
    });

    it('should allow any card discard (slough) when void in led suit', () => {
      const hand: Card[] = [
        makeCard('HEARTS', 'K', 13),
        makeCard('CLUBS', 4, 4),
      ];

      const currentTrick: Trick = {
        leadSuit: 'DIAMONDS',
        cards: [{ seat: 0, card: makeCard('DIAMONDS', 8, 8) }],
      };

      const brokenSuits = new Set<Suit>(['DIAMONDS']);

      // Void in Diamonds, sloughing K♥ is legal
      const result = TrickEngine.validatePlay(
        hand,
        makeCard('HEARTS', 'K', 13),
        currentTrick,
        brokenSuits,
        ['KING_OF_HEARTS'],
        'FREE_MERCY',
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('Lead Restrictions (Diamonds & Hearts)', () => {
    it('should forbid leading Diamonds in Free Mercy before broken if holding other suits', () => {
      const hand: Card[] = [
        makeCard('DIAMONDS', 'A', 14),
        makeCard('SPADES', 2, 2),
      ];
      const emptyTrick: Trick = { leadSuit: null, cards: [] };
      const brokenSuits = new Set<Suit>(); // Diamonds not broken

      const result = TrickEngine.validatePlay(
        hand,
        makeCard('DIAMONDS', 'A', 14),
        emptyTrick,
        brokenSuits,
        ['DIAMONDS'],
        'FREE_MERCY',
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Cannot lead Diamonds until broken');
    });

    it('should allow leading Diamonds in Free Mercy if player holds ONLY Diamonds', () => {
      const handOnlyDiamonds: Card[] = [
        makeCard('DIAMONDS', 'A', 14),
        makeCard('DIAMONDS', 8, 8),
      ];
      const emptyTrick: Trick = { leadSuit: null, cards: [] };
      const brokenSuits = new Set<Suit>();

      const result = TrickEngine.validatePlay(
        handOnlyDiamonds,
        makeCard('DIAMONDS', 'A', 14),
        emptyTrick,
        brokenSuits,
        ['DIAMONDS'],
        'FREE_MERCY',
      );

      expect(result.valid).toBe(true);
    });

    it('should allow leading Diamonds in Free Mercy once broken', () => {
      const hand: Card[] = [
        makeCard('DIAMONDS', 'A', 14),
        makeCard('SPADES', 2, 2),
      ];
      const emptyTrick: Trick = { leadSuit: null, cards: [] };
      const brokenSuits = new Set<Suit>(['DIAMONDS']); // Broken!

      const result = TrickEngine.validatePlay(
        hand,
        makeCard('DIAMONDS', 'A', 14),
        emptyTrick,
        brokenSuits,
        ['DIAMONDS'],
        'FREE_MERCY',
      );

      expect(result.valid).toBe(true);
    });

    it('should allow leading Diamonds at any time in Crazy Complex mode', () => {
      const hand: Card[] = [
        makeCard('DIAMONDS', 'A', 14),
        makeCard('SPADES', 2, 2),
      ];
      const emptyTrick: Trick = { leadSuit: null, cards: [] };
      const brokenSuits = new Set<Suit>(); // Not broken

      const result = TrickEngine.validatePlay(
        hand,
        makeCard('DIAMONDS', 'A', 14),
        emptyTrick,
        brokenSuits,
        ['QUEENS', 'KING_OF_HEARTS', 'DIAMONDS', 'HANDS'],
        'CRAZY_COMPLEX',
      );

      expect(result.valid).toBe(true);
    });

    it('should forbid leading Hearts in King of Hearts contract before broken unless only hearts held', () => {
      const hand: Card[] = [
        makeCard('HEARTS', 8, 8),
        makeCard('CLUBS', 5, 5),
      ];
      const emptyTrick: Trick = { leadSuit: null, cards: [] };
      const brokenSuits = new Set<Suit>();

      const result = TrickEngine.validatePlay(
        hand,
        makeCard('HEARTS', 8, 8),
        emptyTrick,
        brokenSuits,
        ['KING_OF_HEARTS'],
        'FREE_MERCY',
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Cannot lead Hearts until broken');
    });
  });

  describe('Winner Determination', () => {
    it('should award trick to highest power card of the lead suit, ignoring off-suit higher cards', () => {
      const trick: Trick = {
        leadSuit: 'CLUBS',
        cards: [
          { seat: 0, card: makeCard('CLUBS', 10, 10) },
          { seat: 1, card: makeCard('HEARTS', 'A', 14) }, // Sloughed Ace of Hearts!
          { seat: 2, card: makeCard('CLUBS', 'K', 13) }, // Highest Club
          { seat: 3, card: makeCard('CLUBS', 2, 2) },
        ],
      };

      const { winnerSeat, winningCard } = TrickEngine.determineWinner(trick);
      expect(winnerSeat).toBe(2);
      expect(winningCard.rank).toBe('K');
      expect(winningCard.suit).toBe('CLUBS');
    });
  });

  describe('13-Diamond Sweep Rollback', () => {
    it('should detect when a single seat captured all 13 diamonds', () => {
      const allTricks: CollectedTrick[] = [];
      const diamondRanks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];

      // Seat 1 captures all 13 diamonds across tricks
      for (let i = 0; i < 13; i++) {
        allTricks.push({
          seat: 1,
          trick: {
            leadSuit: 'DIAMONDS',
            cards: [
              { seat: 1, card: makeCard('DIAMONDS', diamondRanks[i], i + 2) },
              { seat: 2, card: makeCard('CLUBS', 2, 2) },
              { seat: 3, card: makeCard('CLUBS', 3, 3) },
              { seat: 0, card: makeCard('CLUBS', 4, 4) },
            ],
          },
        });
      }

      const sweep = TrickEngine.check13DiamondSweep(allTricks);
      expect(sweep.isSweep).toBe(true);
      expect(sweep.sweeperSeat).toBe(1);

      // In Crazy Complex: score is zeroed out for all players
      const scoreResult = TrickEngine.calculateNegativeScores(
        allTricks,
        ['QUEENS', 'KING_OF_HEARTS', 'DIAMONDS', 'HANDS'],
        'SOLO',
        'CRAZY_COMPLEX',
      );

      expect(scoreResult.isSweepRollback).toBe(true);
      expect(scoreResult.scores[0]).toBe(0);
      expect(scoreResult.scores[1]).toBe(0);
      expect(scoreResult.scores[2]).toBe(0);
      expect(scoreResult.scores[3]).toBe(0);
    });
  });
});
