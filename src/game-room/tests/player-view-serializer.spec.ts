import { describe, it, expect, beforeEach } from 'vitest';
import { PlayerViewSerializer } from '../serializers/player-view.serializer.js';
import { TrixEngine } from '../../game-engine/trix-engine.js';
import { Card } from '../../game-engine/types/card.types.js';

describe('PlayerViewSerializer (Anti-Cheat Zero-Trust)', () => {
  let engine: TrixEngine;

  beforeEach(() => {
    engine = new TrixEngine('SOLO', 'FREE_MERCY');
  });

  it('should return strictly targetSeat cards and never expose opponents cards', () => {
    const state = engine.getState();
    const targetSeat = 1;
    const roomId = 'test-room-123';

    const serialized = PlayerViewSerializer.serialize(state, targetSeat, roomId);

    // Assert target seat
    expect(serialized.mySeat).toBe(1);
    expect(serialized.roomId).toBe(roomId);
    expect(serialized.myHand.length).toBe(13);

    // Ensure myHand exactly matches seat 1's cards (power descending per suit)
    const expectedHandIds = new Set(state.hands[1].map((c) => c.id));
    for (const card of serialized.myHand) {
      expect(expectedHandIds.has(card.id)).toBe(true);
    }

    // Assert opponents: exactly 3 opponents (seats 0, 2, 3)
    expect(serialized.opponents.length).toBe(3);
    const opponentSeats = serialized.opponents.map((o) => o.seat);
    expect(opponentSeats).toEqual([0, 2, 3]);

    // Crucial anti-cheat assertion: NONE of the opponent objects contain a 'cards' or 'hand' array
    for (const opp of serialized.opponents) {
      expect((opp as any).cards).toBeUndefined();
      expect((opp as any).hand).toBeUndefined();
      expect(opp.remainingCardCount).toBe(13);
    }
  });

  it('should verify zero leakage across all 4 seats', () => {
    const state = engine.getState();
    const roomId = 'test-room-all';

    for (let seat = 0; seat < 4; seat++) {
      const view = PlayerViewSerializer.serialize(state, seat, roomId);
      expect(view.mySeat).toBe(seat);
      expect(view.myHand.length).toBe(state.hands[seat].length);

      // Verify no opponent has cards property
      for (const opp of view.opponents) {
        expect((opp as any).cards).toBeUndefined();
        expect(opp.seat).not.toBe(seat);
      }
    }
  });

  it('should populate canDoubleCards correctly during DOUBLING_PHASE', () => {
    const state = engine.getState();
    const ownerSeat = engine.getActiveKingdom().ownerSeat;

    // Transition to DOUBLING_PHASE with Queens
    engine.selectContracts(['QUEENS']);

    const serialized = PlayerViewSerializer.serialize(state, ownerSeat, 'room-double');
    expect(serialized.isDoublingPhase).toBe(true);

    // If player has a Queen, it must appear in canDoubleCards
    const queensInHand = serialized.myHand.filter((c) => c.rank === 'Q');
    expect(serialized.canDoubleCards.length).toBe(queensInHand.length);
  });

  it('should not allow doubling during normal TRICK_PLAY or TRIX_PLAY', () => {
    // Select TRIX
    engine.selectContracts(['TRIX']);
    const state = engine.getState();

    const serialized = PlayerViewSerializer.serialize(state, 0, 'room-trix');
    expect(serialized.isDoublingPhase).toBe(false);
    expect(serialized.canDoubleCards).toEqual([]);
  });

  it('should throw an error for invalid seat index', () => {
    const state = engine.getState();
    expect(() => PlayerViewSerializer.serialize(state, 4, 'room-err')).toThrow('Invalid targetSeat: 4');
    expect(() => PlayerViewSerializer.serialize(state, -1, 'room-err')).toThrow('Invalid targetSeat: -1');
  });
});
