import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { GameRoomModule } from '../game-room.module.js';
import { BotModule } from '../../bot/bot.module.js';
import { GameGateway } from '../game.gateway.js';
import { GameRoomService } from '../services/game-room.service.js';
import { BotFillService } from '../../bot/bot-fill.service.js';
import { BotActionService } from '../../bot/bot-action.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { JwtService } from '@nestjs/jwt';
import { TrickEngine } from '../../game-engine/trick-engine.js';
import { Card } from '../../game-engine/types/card.types.js';

describe('Bot Execution Pipeline & Unification Integration Tests', () => {
  let gateway: GameGateway;
  let roomService: GameRoomService;
  let botFillService: BotFillService;
  let botActionService: BotActionService;
  let emittedEvents: Array<{ event: string; payload: any }> = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    emittedEvents = [];

    const moduleRef = await Test.createTestingModule({
      imports: [GameRoomModule, BotModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        matchHistory: { create: vi.fn().mockResolvedValue({ id: 'm-1' }) },
        user: { update: vi.fn().mockResolvedValue({}) },
      })
      .overrideProvider(RedisService)
      .useValue({
        getClient: vi.fn().mockReturnValue(null),
      })
      .overrideProvider(JwtService)
      .useValue(new JwtService({ secret: 'test-secret' }))
      .compile();

    gateway = moduleRef.get(GameGateway);
    roomService = moduleRef.get(GameRoomService);
    botFillService = moduleRef.get(BotFillService);
    botActionService = moduleRef.get(BotActionService);

    botActionService.setTestMode(false);

    const mockServer: any = {
      to: vi.fn().mockImplementation((target: string) => ({
        emit: vi.fn().mockImplementation((event: string, payload: any) => {
          emittedEvents.push({ event, payload });
        }),
      })),
      emit: vi.fn().mockImplementation((event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      }),
    };

    gateway.server = mockServer;
    gateway.afterInit(mockServer);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function createMockSocket(id: string, userId: string, displayName: string): any {
    return {
      id,
      data: {
        user: { id: userId, email: `${userId}@trix.local`, displayName },
      },
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn().mockImplementation((event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      }),
    };
  }

  it('should seamlessly execute turns between human and bots through unified executePlayCard', async () => {
    const s0 = createMockSocket('s0', 'u0', 'HumanHost');
    const roomRes = gateway.handleCreateRoom(s0, {
      name: 'Test Room',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
      turnTime: 20,
      isPrivate: false,
      allowBots: true,
    });

    const room = roomService.getRoom(roomRes.roomId)!;
    expect(room).toBeDefined();

    // Populate room with 3 bots
    botFillService.populateRoomWithBots(room.roomId, true);
    await vi.advanceTimersByTimeAsync(100);

    const state = room.engine!.getState();
    const ownerSeat = room.engine!.getActiveKingdom().ownerSeat;

    if (ownerSeat === 0) {
      // Human selects contract
      gateway.handleSelectContract(s0, {
        roomId: room.roomId,
        contracts: ['HANDS'],
      });
    } else {
      // Advance for bot owner contract selection (1500-3000ms)
      await vi.advanceTimersByTimeAsync(3500);
    }

    // If doubling phase is active, advance 8s doubling timer to start trick play
    if (room.engine!.getState().currentPhase === 'DOUBLING_PHASE') {
      await vi.advanceTimersByTimeAsync(8500);
    }

    expect(['TRICK_PLAY', 'TRIX_PLAY']).toContain(room.engine!.getState().currentPhase);

    // Track executePlayCard calls
    const playCardSpy = vi.spyOn(gateway, 'executePlayCard');

    // Run turns until at least one trick is completed or multiple turns taken
    for (let step = 0; step < 8; step++) {
      const currentState = room.engine!.getState();
      const currentTurnSeat = currentState.currentTurnSeat;

      if (currentTurnSeat === 0) {
        // Human's turn: play a legal card
        const hand = currentState.hands[0];
        if (currentState.currentPhase === 'TRICK_PLAY') {
          const legalCards = hand.filter(
            (c) =>
              TrickEngine.validatePlay(
                hand,
                c,
                currentState.currentTrick,
                currentState.brokenSuits,
                currentState.activeContracts,
                currentState.kingdomType,
              ).valid,
          );
          if (legalCards.length > 0) {
            gateway.handlePlayCard(s0, {
              roomId: room.roomId,
              card: legalCards[0],
            });
          }
        }
      } else {
        // Bot's turn: advance 4500ms for bot decision and play
        await vi.advanceTimersByTimeAsync(4500);
      }

      // If trick evaluated, advance 1600ms for 1500ms clearTrickAndAdvance delay
      if (room.engine!.getState().currentPhase === 'TRICK_EVALUATING') {
        await vi.advanceTimersByTimeAsync(1600);
      }
    }

    // Both bots and humans must have routed through executePlayCard
    expect(playCardSpy).toHaveBeenCalled();
  });

  it('should handle turn timeouts by delegating to executePlayCard with isAutoPlay: true', () => {
    const s0 = createMockSocket('s0', 'u0', 'HumanHost');
    const roomRes = gateway.handleCreateRoom(s0, {
      name: 'Timeout Room',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
      turnTime: 20,
    });

    const room = roomService.getRoom(roomRes.roomId)!;
    roomService.joinRoom({ id: 'u1', displayName: 'P1' } as any, 's1', room.roomId);
    roomService.joinRoom({ id: 'u2', displayName: 'P2' } as any, 's2', room.roomId);
    roomService.joinRoom({ id: 'u3', displayName: 'P3' } as any, 's3', room.roomId);

    // Set to Hands contract directly
    room.engine!.selectContracts(['HANDS']);
    const state = room.engine!.getState();
    expect(state.currentPhase).toBe('TRICK_PLAY');

    const turnSeat = state.currentTurnSeat;
    const playCardSpy = vi.spyOn(gateway, 'executePlayCard');

    // Trigger turn timeout for active turn seat
    gateway.handleTurnTimeout(room, turnSeat);

    // Verify executePlayCard was called with isAutoPlay: true
    expect(playCardSpy).toHaveBeenCalledWith(
      room.roomId,
      turnSeat,
      expect.objectContaining({
        suit: expect.any(String),
        rank: expect.anything(),
      }),
      { isAutoPlay: true },
    );

    // Verify auto_played was emitted
    const autoPlayEvent = emittedEvents.find((e) => e.event === 'auto_played');
    expect(autoPlayEvent).toBeDefined();
    expect(autoPlayEvent?.payload.seat).toBe(turnSeat);
  });

  it('should not cancel other bots pending doubling declarations when one bot doubles', async () => {
    const s0 = createMockSocket('s0', 'u0', 'HumanHost');
    const roomRes = gateway.handleCreateRoom(s0, {
      name: 'Doubling Room',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
      turnTime: 20,
    });

    const room = roomService.getRoom(roomRes.roomId)!;
    botFillService.populateRoomWithBots(room.roomId, true);

    // Set Queens contract to open doubling phase
    room.engine!.selectContracts(['QUEENS']);
    expect(room.engine!.getState().currentPhase).toBe('DOUBLING_PHASE');

    // Give bot 1 and bot 2 doubled-eligible Queens
    const hand1 = room.engine!.getState().hands[1];
    const hand2 = room.engine!.getState().hands[2];

    const qHearts: Card = { id: 'HEARTS_Q', suit: 'HEARTS', rank: 'Q', power: 12 };
    const qSpades: Card = { id: 'SPADES_Q', suit: 'SPADES', rank: 'Q', power: 12 };

    hand1.push(
      qHearts,
      { id: 'HEARTS_2', suit: 'HEARTS', rank: 2, power: 2 },
      { id: 'HEARTS_3', suit: 'HEARTS', rank: 3, power: 3 },
      { id: 'HEARTS_4', suit: 'HEARTS', rank: 4, power: 4 },
    );
    hand2.push(
      qSpades,
      { id: 'SPADES_2', suit: 'SPADES', rank: 2, power: 2 },
      { id: 'SPADES_3', suit: 'SPADES', rank: 3, power: 3 },
      { id: 'SPADES_4', suit: 'SPADES', rank: 4, power: 4 },
    );

    const doubleSpy = vi.spyOn(gateway, 'executeDeclareDouble');

    botActionService.evaluateAndTrigger(room);

    // Advance 5500ms to allow all bots' doubling delays (2000-5000ms) to fire
    await vi.advanceTimersByTimeAsync(5500);

    // Both bot 1 and bot 2 should have been able to declare double
    expect(doubleSpy).toHaveBeenCalledWith(
      room.roomId,
      1,
      expect.objectContaining({ rank: 'Q' }),
    );
    expect(doubleSpy).toHaveBeenCalledWith(
      room.roomId,
      2,
      expect.objectContaining({ rank: 'Q' }),
    );
  });
});
