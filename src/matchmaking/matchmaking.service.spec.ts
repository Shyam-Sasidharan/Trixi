import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MatchmakingService } from './matchmaking.service.js';
import { RedisService } from '../common/redis/redis.service.js';
import { GameRoomService } from '../game-room/services/game-room.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BotFillService } from '../bot/bot-fill.service.js';

describe('MatchmakingService', () => {
  let service: MatchmakingService;
  let gameRoomService: GameRoomService;
  let mockBotFillService: any;

  beforeEach(async () => {
    const mockPrisma = {
      matchHistory: { create: () => Promise.resolve({ id: 'mock' }) },
      user: { update: () => Promise.resolve({}) },
    };

    const mockRedis = {
      getClient: () => ({ status: 'closed' }), // force in-memory fallback for test determinism
    };

    mockBotFillService = {
      populateRoomWithBots: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        GameRoomService,
        { provide: RedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BotFillService, useValue: mockBotFillService },
      ],
    }).compile();

    service = module.get<MatchmakingService>(MatchmakingService);
    gameRoomService = module.get<GameRoomService>(GameRoomService);
    service.setBotFillService(mockBotFillService as any);
  });

  afterEach(() => {
    service.clearAllTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should enqueue players and automatically form a 4-player match', async () => {
    const p1 = { id: 'u1', displayName: 'Player 1' };
    const p2 = { id: 'u2', displayName: 'Player 2' };
    const p3 = { id: 'u3', displayName: 'Player 3' };
    const p4 = { id: 'u4', displayName: 'Player 4' };

    const res1 = await service.enqueue(p1, 's1', 'SOLO', 'FREE_MERCY');
    expect(res1.matchFound).toBe(false);

    const res2 = await service.enqueue(p2, 's2', 'SOLO', 'FREE_MERCY');
    expect(res2.matchFound).toBe(false);

    const res3 = await service.enqueue(p3, 's3', 'SOLO', 'FREE_MERCY');
    expect(res3.matchFound).toBe(false);

    // 4th player completes queue immediately
    const res4 = await service.enqueue(p4, 's4', 'SOLO', 'FREE_MERCY');
    expect(res4.matchFound).toBe(true);
    expect(res4.room).toBeDefined();
    expect(res4.room?.status).toBe('IN_PROGRESS');
    expect(res4.room?.players.every((p) => p !== null)).toBe(true);
    expect(res4.players?.length).toBe(4);
  });

  it('should dequeue a player when requested', async () => {
    const p1 = { id: 'u-cancel', displayName: 'Cancel Player' };
    await service.enqueue(p1, 's-cancel', 'SOLO', 'FREE_MERCY');

    const statusBefore = await service.getQueueStatus('u-cancel');
    expect(statusBefore.inQueue).toBe(true);

    const dequeued = await service.dequeue('u-cancel');
    expect(dequeued).toBe(true);

    const statusAfter = await service.getQueueStatus('u-cancel');
    expect(statusAfter.inQueue).toBe(false);
  });

  it('should start 6-second timer and backfill remaining seats with bots on timeout', async () => {
    vi.useFakeTimers();
    const p1 = { id: 'u-solo', displayName: 'Solo Player' };
    const p2 = { id: 'u-duo', displayName: 'Duo Player' };

    await service.enqueue(p1, 's-solo', 'SOLO', 'FREE_MERCY');
    await service.enqueue(p2, 's-duo', 'SOLO', 'FREE_MERCY');

    expect(service.hasActiveTimer('SOLO', 'FREE_MERCY')).toBe(true);

    // Advance 6000ms: timer expires and forms room with p1 and p2, then calls botFillService
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockBotFillService.populateRoomWithBots).toHaveBeenCalled();
    const status = await service.getQueueStatus('u-solo');
    expect(status.inQueue).toBe(false);

    vi.useRealTimers();
  });
});
