import { describe, expect, it } from 'vitest';
import { DoublingManager } from '../doubling.js';
import { Card } from '../types/card.types.js';

describe('DoublingManager', () => {
  const makeCard = (suit: 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES', rank: any, power: number): Card => ({
    id: `${suit}_${rank}`,
    suit,
    rank,
    power,
  });

  describe('Eligibility', () => {
    it('should allow Queens to be doubled if QUEENS contract is active', () => {
      const queen = makeCard('CLUBS', 'Q', 12);
      expect(DoublingManager.isCardEligibleForDoubling(queen, ['QUEENS'])).toBe(true);
      expect(DoublingManager.isCardEligibleForDoubling(queen, ['HANDS', 'DIAMONDS'])).toBe(false);
    });

    it('should allow King of Hearts to be doubled if KING_OF_HEARTS is active', () => {
      const kingOfHearts = makeCard('HEARTS', 'K', 13);
      expect(DoublingManager.isCardEligibleForDoubling(kingOfHearts, ['KING_OF_HEARTS'])).toBe(true);

      const kingOfSpades = makeCard('SPADES', 'K', 13);
      expect(DoublingManager.isCardEligibleForDoubling(kingOfSpades, ['KING_OF_HEARTS'])).toBe(false);
    });

    it('should reject non-doublable cards', () => {
      const ace = makeCard('HEARTS', 'A', 14);
      const jack = makeCard('DIAMONDS', 'J', 11);
      expect(DoublingManager.isCardEligibleForDoubling(ace, ['QUEENS', 'KING_OF_HEARTS'])).toBe(false);
      expect(DoublingManager.isCardEligibleForDoubling(jack, ['QUEENS', 'KING_OF_HEARTS'])).toBe(false);
    });
  });

  describe('Solo Mode Doubling Resolution', () => {
    it('should allocate -50 to opponent collector and +25 to doubler for Queen', () => {
      const doubledQueen = makeCard('SPADES', 'Q', 12);
      const doublerSeat = 0;
      const collectorSeat = 2; // Opponent collected
      const trickLeadSeat = 1;

      const points = DoublingManager.resolveDoubledCard(
        doubledQueen,
        doublerSeat,
        collectorSeat,
        trickLeadSeat,
        'SOLO',
      );

      expect(points[collectorSeat]).toBe(-50);
      expect(points[doublerSeat]).toBe(25);
      expect(points[1]).toBe(0);
      expect(points[3]).toBe(0);
    });

    it('should allocate -150 to opponent collector and +75 to doubler for King of Hearts', () => {
      const doubledKing = makeCard('HEARTS', 'K', 13);
      const doublerSeat = 3;
      const collectorSeat = 1;
      const trickLeadSeat = 0;

      const points = DoublingManager.resolveDoubledCard(
        doubledKing,
        doublerSeat,
        collectorSeat,
        trickLeadSeat,
        'SOLO',
      );

      expect(points[collectorSeat]).toBe(-150);
      expect(points[doublerSeat]).toBe(75);
    });

    it('should penalize doubler -50 and reward trick leader +25 when doubler collects their own doubled Queen (self-take)', () => {
      const doubledQueen = makeCard('CLUBS', 'Q', 12);
      const doublerSeat = 1;
      const collectorSeat = 1; // Doubler took their own card!
      const trickLeadSeat = 3; // Player at seat 3 led clubs and forced collection

      const points = DoublingManager.resolveDoubledCard(
        doubledQueen,
        doublerSeat,
        collectorSeat,
        trickLeadSeat,
        'SOLO',
      );

      expect(points[doublerSeat]).toBe(-50);
      expect(points[trickLeadSeat]).toBe(25);
      expect(points[0]).toBe(0);
      expect(points[2]).toBe(0);
    });

    it('should penalize doubler -150 and reward trick leader +75 when doubler collects their own doubled King of Hearts', () => {
      const doubledKing = makeCard('HEARTS', 'K', 13);
      const doublerSeat = 2;
      const collectorSeat = 2; // Doubler collected their own K♥
      const trickLeadSeat = 0;

      const points = DoublingManager.resolveDoubledCard(
        doubledKing,
        doublerSeat,
        collectorSeat,
        trickLeadSeat,
        'SOLO',
      );

      expect(points[doublerSeat]).toBe(-150);
      expect(points[trickLeadSeat]).toBe(75);
    });
  });

  describe('Team Mode Doubling Resolution', () => {
    // Team 1: Seats 0 & 2
    // Team 2: Seats 1 & 3

    it('should penalize opponent team and reward doubler team when opponent collects doubled card', () => {
      const doubledQueen = makeCard('HEARTS', 'Q', 12);
      const doublerSeat = 0; // Team 1
      const collectorSeat = 1; // Team 2 (Opponent)
      const trickLeadSeat = 2;

      const points = DoublingManager.resolveDoubledCard(
        doubledQueen,
        doublerSeat,
        collectorSeat,
        trickLeadSeat,
        'TEAM',
      );

      // Team 2 gets -50, Team 1 gets +25
      expect(points[collectorSeat]).toBe(-50);
      expect(points[doublerSeat]).toBe(25);
    });

    it('should penalize doubler team -50 and reward opponent team +25 when partner forces collection (self-team take)', () => {
      const doubledQueen = makeCard('DIAMONDS', 'Q', 12);
      const doublerSeat = 0; // Team 1
      const collectorSeat = 2; // Partner in Team 1 collected it!
      const trickLeadSeat = 1; // Opponent in Team 2 led the trick

      const points = DoublingManager.resolveDoubledCard(
        doubledQueen,
        doublerSeat,
        collectorSeat,
        trickLeadSeat,
        'TEAM',
      );

      // Team 1 takes penalty: -50
      expect(points[collectorSeat]).toBe(-50);
      // Team 2 gets reward: +25
      expect(points[trickLeadSeat]).toBe(25);
    });

    it('should penalize doubler team -150 and reward opponent team +75 when doubler self-collects doubled King of Hearts in Team mode', () => {
      const doubledKing = makeCard('HEARTS', 'K', 13);
      const doublerSeat = 1; // Team 2
      const collectorSeat = 1; // Team 2 self-take
      const trickLeadSeat = 0; // Team 1 led Hearts

      const points = DoublingManager.resolveDoubledCard(
        doubledKing,
        doublerSeat,
        collectorSeat,
        trickLeadSeat,
        'TEAM',
      );

      // Team 2 takes penalty -150
      expect(points[collectorSeat]).toBe(-150);
      // Team 1 gets bonus +75
      expect(points[trickLeadSeat]).toBe(75);
    });
  });
});
