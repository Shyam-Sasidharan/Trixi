import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameRoomService } from '../../game-room/services/game-room.service.js';
import { BotFillService } from '../bot-fill.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PlayerViewSerializer, PlayerSeatInfo } from '../../game-room/serializers/player-view.serializer.js';

describe('BotFillService (Matchmaking Backfill & Anti-Detection Disguise)', () => {
  let roomService: GameRoomService;
  let botFillService: BotFillService;
  let mockServer: any;
  let mockGateway: any;

  beforeEach(() => {
    vi.useFakeTimers();

    const mockPrisma = {
      matchHistory: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };

    roomService = new GameRoomService(mockPrisma as PrismaService);
    botFillService = new BotFillService(roomService);

    mockServer = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };

    mockGateway = {
      server: mockServer,
      startRoomTurnTimer: vi.fn(),
      broadcastMaskedState: vi.fn(),
    };

    botFillService.setGateway(mockGateway as any);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should trigger backfill, seat 3 unique bot personas, and start match when 4th player joins', () => {
    const humanHost = {
      id: 'human-user-123',
      displayName: 'TrixMasterPro',
      avatarUrl: 'https://cdn.trixi.com/avatars/human.png',
      level: 15,
      coins: 4500,
      stats: { gamesPlayed: 120, wins: 72, losses: 48, soloWins: 42, teamWins: 30, winRate: 60.0 },
    };

    const room = roomService.createRoom(humanHost, 'socket-human-1', {
      name: 'Championship Table',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
      turnTime: 20,
    });

    expect(room.status).toBe('WAITING');
    expect(room.players[0]?.userId).toBe('human-user-123');
    expect(room.players[1]).toBeNull();
    expect(room.players[2]).toBeNull();
    expect(room.players[3]).toBeNull();

    // Schedule backfill with 4000ms delay and 1000ms stagger between bots
    botFillService.scheduleBackfill(room, { backfillDelayMs: 4000, staggerDelayMs: 1000 });

    // Advance 4000ms: backfill timer fires and schedules 3 staggered bot entries
    vi.advanceTimersByTime(4000);
    expect(room.status).toBe('WAITING');

    // Bot 1 joins at +1000ms (Seat 1)
    vi.advanceTimersByTime(1000);
    expect(room.players[1]).not.toBeNull();
    expect(room.players[2]).toBeNull();
    expect(room.status).toBe('WAITING');

    // Bot 2 joins at +1000ms (Seat 2)
    vi.advanceTimersByTime(1000);
    expect(room.players[2]).not.toBeNull();
    expect(room.players[3]).toBeNull();
    expect(room.status).toBe('WAITING');

    // Bot 3 joins at +1000ms (Seat 3) -> 4th player filled -> Match Starts!
    vi.advanceTimersByTime(1000);
    expect(room.players[3]).not.toBeNull();
    expect(room.status).toBe('IN_PROGRESS');
    expect(room.engine).toBeDefined();

    // Verify 3 distinct bot personas were added (different IDs and names)
    const userIds = room.players.map((p) => p!.userId);
    const displayNames = room.players.map((p) => p!.displayName);

    expect(new Set(userIds).size).toBe(4);
    expect(new Set(displayNames).size).toBe(4);

    // Verify match_started was emitted
    expect(mockServer.to).toHaveBeenCalledWith(room.roomId);
    expect(mockServer.emit).toHaveBeenCalledWith('match_started', {
      roomId: room.roomId,
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
    });
  });

  it('should verify that all player payloads contain complete profile fields and NO isBot: true leaks', () => {
    const humanHost = {
      id: 'human-user-999',
      displayName: 'CaptainTrix',
      avatarUrl: 'https://cdn.trixi.com/avatars/human.png',
      level: 10,
      coins: 3000,
      stats: { gamesPlayed: 50, wins: 30, losses: 20, soloWins: 18, teamWins: 12, winRate: 60.0 },
    };

    const room = roomService.createRoom(humanHost, 'socket-human-999', {
      name: 'Public Table',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
      turnTime: 20,
    });

    // Populate remaining 3 seats immediately with bots
    botFillService.populateRoomWithBots(room.roomId, true);

    expect(room.status).toBe('IN_PROGRESS');
    expect(room.players.every((p) => p !== null)).toBe(true);

    // 1. Verify player_joined events emitted to the client
    const playerJoinedCalls = mockServer.emit.mock.calls.filter(
      (call: any[]) => call[0] === 'player_joined',
    );

    expect(playerJoinedCalls.length).toBe(2); // Seats 1 and 2 emit player_joined (seat 3 triggers match_started)

    for (const call of playerJoinedCalls) {
      const payload = call[1];
      expect(payload.roomId).toBe(room.roomId);
      expect(payload.seat).toBeGreaterThan(0);

      // Must have complete profile fields
      expect(payload.user.id).toBeDefined();
      expect(payload.user.displayName).toBeDefined();
      expect(payload.user.avatarUrl).toBeDefined();
      expect(payload.user.level).toBeGreaterThanOrEqual(3);
      expect(payload.user.coins).toBeGreaterThanOrEqual(1200);
      expect(payload.user.stats).toBeDefined();
      expect(payload.user.stats.gamesPlayed).toBeGreaterThan(0);
      expect(payload.user.stats.winRate).toBeGreaterThan(0);

      // ANTI-DETECTION ASSERTIONS: NO isBot: true leak
      expect(payload.isBot).toBeUndefined();
      expect(payload.user.isBot).toBeUndefined();
    }

    // 2. Verify serialized anti-cheat game state view for the human player (Seat 0)
    const seatsInfo: Record<number, PlayerSeatInfo> = {};
    for (let s = 0; s < 4; s++) {
      const p = room.players[s]!;
      seatsInfo[s] = {
        seat: s,
        userId: p.userId,
        socketId: p.socketId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        level: p.level,
        coins: p.coins,
        stats: p.stats,
        isConnected: p.isConnected,
        isBot: false, // Disguised!
      };
    }

    const humanStateView = PlayerViewSerializer.serialize(
      room.engine!.getState(),
      0, // Human at Seat 0
      room.roomId,
      { turnTimeLimit: 20, seatsInfo },
    );

    expect(humanStateView.mySeat).toBe(0);
    expect(humanStateView.opponents.length).toBe(3);

    for (const opp of humanStateView.opponents) {
      // Complete profile fields disguise
      expect(opp.displayName).toBeDefined();
      expect(opp.avatarUrl).toBeDefined();
      expect(opp.level).toBeGreaterThanOrEqual(3);
      expect(opp.coins).toBeGreaterThanOrEqual(1200);
      expect(opp.stats).toBeDefined();
      expect(opp.stats.winRate).toBeGreaterThan(0);

      // CRUCIAL ANTI-DETECTION ASSERTION: Opponent isBot must NEVER be true!
      expect(opp.isBot).toBe(false);
      expect(opp.isBot).not.toBe(true);
    }
  });
});
