import { describe, expect, it } from 'vitest';
import { TrixContract } from '../contracts/trix.contract.js';
import { Card } from '../types/card.types.js';

describe('TrixContract', () => {
  const makeCard = (suit: 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES', rank: any, power: number): Card => ({
    id: `${suit}_${rank}`,
    suit,
    rank,
    power,
  });

  describe('Column Initiation', () => {
    it('should strictly require a Jack to open an empty suit column', () => {
      const columns = TrixContract.createEmptyTrixColumns();
      const hand: Card[] = [
        makeCard('HEARTS', 'Q', 12),
        makeCard('HEARTS', 10, 10),
        makeCard('HEARTS', 'J', 11),
      ];

      // Cannot play Queen on unopened Hearts column
      const queenPlay = TrixContract.validatePlay(hand[0], hand, columns);
      expect(queenPlay.valid).toBe(false);
      expect(queenPlay.reason).toContain('must be opened with a Jack');

      // Cannot play 10 on unopened Hearts column
      const tenPlay = TrixContract.validatePlay(hand[1], hand, columns);
      expect(tenPlay.valid).toBe(false);

      // CAN play Jack on unopened Hearts column
      const jackPlay = TrixContract.validatePlay(hand[2], hand, columns);
      expect(jackPlay.valid).toBe(true);
    });
  });

  describe('Ladder Progression', () => {
    it('should allow building up and down once Jack is placed', () => {
      let columns = TrixContract.createEmptyTrixColumns();
      const jackClubs = makeCard('CLUBS', 'J', 11);

      // Open Clubs with Jack
      columns = TrixContract.applyCardPlay(jackClubs, columns);
      expect(columns.CLUBS.isOpen).toBe(true);
      expect(columns.CLUBS.minRank).toBe(11);
      expect(columns.CLUBS.maxRank).toBe(11);

      const hand: Card[] = [
        makeCard('CLUBS', 'Q', 12), // Valid (Jack + 1)
        makeCard('CLUBS', 10, 10),  // Valid (Jack - 1)
        makeCard('CLUBS', 'K', 13), // Invalid (must play Q first)
        makeCard('CLUBS', 9, 9),    // Invalid (must play 10 first)
      ];

      // Queen is valid
      expect(TrixContract.validatePlay(hand[0], hand, columns).valid).toBe(true);
      // 10 is valid
      expect(TrixContract.validatePlay(hand[1], hand, columns).valid).toBe(true);
      // King is invalid before Queen
      expect(TrixContract.validatePlay(hand[2], hand, columns).valid).toBe(false);
      // 9 is invalid before 10
      expect(TrixContract.validatePlay(hand[3], hand, columns).valid).toBe(false);

      // Play Queen
      columns = TrixContract.applyCardPlay(hand[0], columns);
      expect(columns.CLUBS.maxRank).toBe(12);

      // Now King is valid, but Ace is still invalid
      expect(TrixContract.validatePlay(hand[2], hand, columns).valid).toBe(true);
      const ace = makeCard('CLUBS', 'A', 14);
      expect(TrixContract.validatePlay(ace, [ace], columns).valid).toBe(false);
    });
  });

  describe('Mandatory Play & Pass Validation', () => {
    it('should strictly FORBID passing if player holds any playable card', () => {
      const columns = TrixContract.createEmptyTrixColumns();
      const handWithJack: Card[] = [
        makeCard('SPADES', 'J', 11), // Playable! Can open Spades
        makeCard('HEARTS', 4, 4),
      ];

      const passCheck = TrixContract.validatePass(handWithJack, columns);
      expect(passCheck.canPass).toBe(false);
      expect(passCheck.reason).toContain('playable card(s) and cannot pass');
    });

    it('should ALLOW passing when player has no playable cards', () => {
      const columns = TrixContract.createEmptyTrixColumns();
      const handWithoutJack: Card[] = [
        makeCard('SPADES', 2, 2),
        makeCard('HEARTS', 'Q', 12),
        makeCard('CLUBS', 10, 10),
      ];

      const passCheck = TrixContract.validatePass(handWithoutJack, columns);
      expect(passCheck.canPass).toBe(true);
    });
  });

  describe('Finishing Scores Distribution', () => {
    it('should correctly allocate scores (+200, +150, +100, +50) based on finishing order', () => {
      // 1st: Seat 2, 2nd: Seat 0, 3rd: Seat 3, 4th: Seat 1
      const finishingOrder = [2, 0, 3, 1];
      const scores = TrixContract.calculateTrixScores(finishingOrder);

      expect(scores[2]).toBe(200);
      expect(scores[0]).toBe(150);
      expect(scores[3]).toBe(100);
      expect(scores[1]).toBe(50);

      const total = scores[0] + scores[1] + scores[2] + scores[3];
      expect(total).toBe(500);
    });
  });
});
