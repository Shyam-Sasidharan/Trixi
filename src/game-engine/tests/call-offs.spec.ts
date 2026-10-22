import { describe, expect, it } from 'vitest';
import { CallOffValidator } from '../call-off.validator.js';
import { Card } from '../types/card.types.js';

describe('CallOffValidator', () => {
  const makeCard = (suit: 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES', rank: any, power: number): Card => ({
    id: `${suit}_${rank}`,
    suit,
    rank,
    power,
  });

  describe('King of Hearts Call-Off', () => {
    it('should trigger call-off when a player holds King of Hearts alone (no other hearts)', () => {
      const hand: Card[] = [
        makeCard('HEARTS', 'K', 13),
        makeCard('SPADES', 'A', 14),
        makeCard('SPADES', 10, 10),
        makeCard('DIAMONDS', 7, 7),
        makeCard('CLUBS', 4, 4),
      ];

      expect(CallOffValidator.isKingOfHeartsCallOff(hand)).toBe(true);
    });

    it('should trigger call-off when a player holds King of Hearts and Ace of Hearts only', () => {
      const hand: Card[] = [
        makeCard('HEARTS', 'K', 13),
        makeCard('HEARTS', 'A', 14),
        makeCard('SPADES', 10, 10),
        makeCard('CLUBS', 'Q', 12),
      ];

      expect(CallOffValidator.isKingOfHeartsCallOff(hand)).toBe(true);
    });

    it('should NOT trigger call-off when player holds K♥ backed by other hearts', () => {
      const handWithThirdHeart: Card[] = [
        makeCard('HEARTS', 'K', 13),
        makeCard('HEARTS', 'A', 14),
        makeCard('HEARTS', 2, 2),
        makeCard('SPADES', 10, 10),
      ];
      expect(CallOffValidator.isKingOfHeartsCallOff(handWithThirdHeart)).toBe(false);

      const handWithNormalHearts: Card[] = [
        makeCard('HEARTS', 'K', 13),
        makeCard('HEARTS', 7, 7),
        makeCard('SPADES', 5, 5),
      ];
      expect(CallOffValidator.isKingOfHeartsCallOff(handWithNormalHearts)).toBe(false);
    });

    it('should NOT trigger call-off when player does not hold K♥', () => {
      const handWithoutKing: Card[] = [
        makeCard('HEARTS', 'A', 14),
        makeCard('HEARTS', 10, 10),
        makeCard('DIAMONDS', 7, 7),
      ];
      expect(CallOffValidator.isKingOfHeartsCallOff(handWithoutKing)).toBe(false);
    });

    it('should correctly identify the affected seat in checkKingOfHeartsCallOff', () => {
      const hands: Record<number, Card[]> = {
        0: [makeCard('HEARTS', 10, 10)],
        1: [makeCard('HEARTS', 'K', 13), makeCard('DIAMONDS', 2, 2)], // Solitary K♥
        2: [makeCard('SPADES', 5, 5)],
        3: [makeCard('CLUBS', 9, 9)],
      };

      const result = CallOffValidator.checkKingOfHeartsCallOff(hands);
      expect(result.isCalledOff).toBe(true);
      expect(result.affectedSeat).toBe(1);
      expect(result.reason).toBe('KING_OF_HEARTS_SOLITARY');
    });
  });

  describe('Trix Call-Off', () => {
    it('should trigger call-off when a player holds all four (2s) cards', () => {
      const handWithFourTwos: Card[] = [
        makeCard('DIAMONDS', 2, 2),
        makeCard('CLUBS', 2, 2),
        makeCard('HEARTS', 2, 2),
        makeCard('SPADES', 2, 2),
        makeCard('SPADES', 'K', 13),
      ];

      expect(CallOffValidator.isTrixCallOff(handWithFourTwos)).toBe(true);
    });

    it('should trigger call-off when a player holds three 2s and only the 3 of the fourth suit', () => {
      // Holds 2♦, 2♣, 2♥ and 3♠ (no 2♠)
      const handWithThreeTwosAndThree: Card[] = [
        makeCard('DIAMONDS', 2, 2),
        makeCard('CLUBS', 2, 2),
        makeCard('HEARTS', 2, 2),
        makeCard('SPADES', 3, 3), // Fourth suit has 3
        makeCard('HEARTS', 'A', 14),
      ];

      expect(CallOffValidator.isTrixCallOff(handWithThreeTwosAndThree)).toBe(true);
    });

    it('should NOT trigger call-off when hand does not meet Trix criteria', () => {
      // Only two 2s
      const handWithTwoTwos: Card[] = [
        makeCard('DIAMONDS', 2, 2),
        makeCard('CLUBS', 2, 2),
        makeCard('HEARTS', 5, 5),
        makeCard('SPADES', 8, 8),
      ];
      expect(CallOffValidator.isTrixCallOff(handWithTwoTwos)).toBe(false);

      // Three 2s, but fourth suit has 5 (not 3)
      const handWithThreeTwosWrongCard: Card[] = [
        makeCard('DIAMONDS', 2, 2),
        makeCard('CLUBS', 2, 2),
        makeCard('HEARTS', 2, 2),
        makeCard('SPADES', 5, 5), // No 3 of spades
      ];
      expect(CallOffValidator.isTrixCallOff(handWithThreeTwosWrongCard)).toBe(false);
    });

    it('should identify the affected seat in checkTrixCallOff', () => {
      const hands: Record<number, Card[]> = {
        0: [makeCard('DIAMONDS', 5, 5)],
        1: [makeCard('CLUBS', 10, 10)],
        2: [
          makeCard('DIAMONDS', 2, 2),
          makeCard('CLUBS', 2, 2),
          makeCard('HEARTS', 2, 2),
          makeCard('SPADES', 2, 2),
        ],
        3: [makeCard('HEARTS', 'Q', 12)],
      };

      const result = CallOffValidator.checkTrixCallOff(hands);
      expect(result.isCalledOff).toBe(true);
      expect(result.affectedSeat).toBe(2);
      expect(result.reason).toBe('TRIX_FOUR_TWOS');
    });
  });
});
