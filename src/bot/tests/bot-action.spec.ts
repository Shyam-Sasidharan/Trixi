import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BotActionService } from '../bot-action.service.js';
import { BotBrainService } from '../bot-brain.service.js';
import { GameRoomService } from '../../game-room/services/game-room.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

describe('BotActionService (Turn Automation & Latency Simulation)', () => {
  let actionService: BotActionService;
  let brainService: BotBrainService;
  let roomService: GameRoomService;
  let mockGateway: any;
  let mockServer: any;

  beforeEach(() => {
    vi.useFakeTimers();

    const mockPrisma = {
      matchHistory: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };

    roomService = new GameRoomService(mockPrisma as PrismaService);
    brainService = new BotBrainService();
    actionService = new BotActionService(brainService, roomService);

    mockServer = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };

    mockGateway = {
      server: mockServer,
      executeSelectContract: vi.fn(),
      executeDeclareDouble: vi.fn(),
      executePlayCard: vi.fn(),
      executePassTrix: vi.fn(),
      startRoomTurnTimer: vi.fn(),
      broadcastMaskedState: vi.fn(),
    };

    actionService.setGateway(mockGateway as any);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should automate contract selection when Kingdom Owner is a bot with human jitter delay', () => {
    // Create a 4-player match where host is human, but bot is at seat 1
    const host = { id: 'host-1', displayName: 'Host' };
    const room = roomService.createRoom(host, 's-host', {
      name: 'Test Room',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
    });

    roomService.joinRoom({ id: 'bot-1', displayName: 'Bot Tariq', isBot: true } as any, 's-b1', room.roomId);
    roomService.joinRoom({ id: 'bot-2', displayName: 'Bot Zaid', isBot: true } as any, 's-b2', room.roomId);
    roomService.joinRoom({ id: 'bot-3', displayName: 'Bot Layla', isBot: true } as any, 's-b3', room.roomId);

    expect(room.status).toBe('IN_PROGRESS');

    const state = room.engine!.getState();
    const activeKingdom = room.engine!.getActiveKingdom();
    const ownerSeat = activeKingdom.ownerSeat;

    // Ensure the owner is marked as a bot for this test scenario
    room.players[ownerSeat]!.isBot = true;

    // Trigger evaluateAndTrigger
    actionService.evaluateAndTrigger(room);

    // No immediate execution at 0ms (human delay)
    expect(mockGateway.executeSelectContract).not.toHaveBeenCalled();

    // Advance 3000ms: contract selection should have triggered
    vi.advanceTimersByTime(3000);
    expect(mockGateway.executeSelectContract).toHaveBeenCalledWith(
      room.roomId,
      ownerSeat,
      expect.any(Array),
    );
  });

  it('should automate trick card play with human delay when turn belongs to a bot', () => {
    const host = { id: 'host-1', displayName: 'Host' };
    const room = roomService.createRoom(host, 's-host', {
      name: 'Trick Room',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
    });

    roomService.joinRoom({ id: 'bot-1', displayName: 'Bot Tariq', isBot: true } as any, 's-b1', room.roomId);
    roomService.joinRoom({ id: 'bot-2', displayName: 'Bot Zaid', isBot: true } as any, 's-b2', room.roomId);
    roomService.joinRoom({ id: 'bot-3', displayName: 'Bot Layla', isBot: true } as any, 's-b3', room.roomId);

    // Start with Hands contract
    room.engine!.selectContracts(['HANDS']);
    const state = room.engine!.getState();
    expect(state.currentPhase).toBe('TRICK_PLAY');

    const turnSeat = state.currentTurnSeat;
    room.players[turnSeat]!.isBot = true;

    actionService.evaluateAndTrigger(room);

    // Human delay check: 0ms should not play
    expect(mockGateway.executePlayCard).not.toHaveBeenCalled();

    // Advance time by 4200ms (max normal decision delay)
    vi.advanceTimersByTime(4200);

    expect(mockGateway.executePlayCard).toHaveBeenCalledWith(
      room.roomId,
      turnSeat,
      expect.objectContaining({
        suit: expect.any(String),
        rank: expect.anything(),
        power: expect.any(Number),
      }),
    );
  });

  it('should announce "one_card_announcement" event after a 1.2s delay when bot drops to 1 card in Trix', () => {
    const host = { id: 'host-1', displayName: 'Host' };
    const room = roomService.createRoom(host, 's-host', {
      name: 'Trix Room',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
    });

    roomService.joinRoom({ id: 'bot-1', displayName: 'Bot Tariq', isBot: true } as any, 's-b1', room.roomId);
    roomService.joinRoom({ id: 'bot-2', displayName: 'Bot Zaid', isBot: true } as any, 's-b2', room.roomId);
    roomService.joinRoom({ id: 'bot-3', displayName: 'Bot Layla', isBot: true } as any, 's-b3', room.roomId);

    room.engine!.selectContracts(['TRIX']);
    const state = room.engine!.getState();
    expect(state.currentPhase).toBe('TRIX_PLAY');

    const turnSeat = state.currentTurnSeat;
    room.players[turnSeat]!.isBot = true;

    // Set bot hand to exactly 2 cards with a playable move on Trix columns
    state.trixColumns.SPADES.isOpen = false;
    (state.hands as any)[turnSeat] = [
      { id: 'j-spades', suit: 'SPADES', rank: 'J', power: 11 },
      { id: '2-spades', suit: 'SPADES', rank: 2, power: 2 },
    ];

    actionService.evaluateAndTrigger(room);

    // Advance 2200ms: play has executed (delay is 1200-2200ms), but 1.2s announcement has not fired yet
    vi.advanceTimersByTime(2200);
    expect(mockGateway.executePlayCard).toHaveBeenCalled();
    expect(mockServer.emit).not.toHaveBeenCalledWith('one_card_announcement', expect.any(Object));

    // Advance remaining time (+1500ms): announcement timer expires and emits event
    vi.advanceTimersByTime(1500);
    expect(mockServer.emit).toHaveBeenCalledWith('one_card_announcement', {
      roomId: room.roomId,
      seat: turnSeat,
      displayName: room.players[turnSeat]!.displayName,
      remainingCards: 1,
    });
  });

  it('should seamlessly take over turn rotation on clean disconnect handover when grace timer expires', () => {
    const host = { id: 'human-p1', displayName: 'Human Player' };
    const room = roomService.createRoom(host, 'sock-human', {
      name: 'Grace Room',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
    });

    roomService.joinRoom({ id: 'bot-1', displayName: 'Bot Tariq', isBot: true } as any, 's-b1', room.roomId);
    roomService.joinRoom({ id: 'bot-2', displayName: 'Bot Zaid', isBot: true } as any, 's-b2', room.roomId);
    roomService.joinRoom({ id: 'bot-3', displayName: 'Bot Layla', isBot: true } as any, 's-b3', room.roomId);

    room.engine!.selectContracts(['HANDS']);
    const state = room.engine!.getState();

    // Force current turn to seat 0 (the human)
    (state as any).currentTurnSeat = 0;
    expect(room.players[0]!.isBot).toBe(false);

    // Human disconnects
    roomService.handleDisconnect('sock-human', (roomId, seat) => {
      // Grace timer callback
      expect(room.players[0]!.isBot).toBe(true);
      actionService.evaluateAndTrigger(room);
    });

    // Advance 30 seconds for grace timer expiration
    vi.advanceTimersByTime(30000);

    // Grace expired! Seat 0 is now isBot: true
    expect(room.players[0]!.isBot).toBe(true);

    // Advance by bot decision delay (up to 4200ms)
    vi.advanceTimersByTime(4200);

    // BotActionService took over and played for Seat 0!
    expect(mockGateway.executePlayCard).toHaveBeenCalledWith(
      room.roomId,
      0,
      expect.any(Object),
    );
  });
});
