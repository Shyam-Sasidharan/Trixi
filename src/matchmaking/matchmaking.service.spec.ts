import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { MatchmakingService } from './matchmaking.service.js';
import { RedisService } from '../common/redis/redis.service.js';
import { GameRoomService } from '../game-room/services/game-room.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('MatchmakingService', () => {
  let service: MatchmakingService;
  let gameRoomService: GameRoomService;

  beforeEach(async () => {
    const mockPrisma = {
      matchHistory: { create: () => Promise.resolve({ id: 'mock' }) },
      user: { update: () => Promise.resolve({}) },
    };

    const mockRedis = {
      getClient: () => ({ status: 'closed' }), // force in-memory fallback for test determinism
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        GameRoomService,
        { provide: RedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MatchmakingService>(MatchmakingService);
    gameRoomService = module.get<GameRoomService>(GameRoomService);
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

    // 4th player completes queue
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
});
