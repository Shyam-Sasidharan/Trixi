import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LeaderboardService } from '../leaderboard.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'user-1',
            displayName: 'TopDog',
            avatarUrl: null,
            level: 10,
            xp: 5000,
            coins: 2000,
            isVip: true,
            stats: {
              gamesPlayed: 100,
              wins: 80,
              losses: 20,
              soloWins: 50,
              teamWins: 30,
              totalQueensCaptured: 5,
              totalHeartsCaptured: 2,
              trixFirstPlaceCount: 40,
            },
          },
          {
            id: 'user-2',
            displayName: 'RunnerUp',
            avatarUrl: null,
            level: 8,
            xp: 3500,
            coins: 1200,
            isVip: false,
            stats: {
              gamesPlayed: 50,
              wins: 30,
              losses: 20,
              soloWins: 15,
              teamWins: 15,
              totalQueensCaptured: 10,
              totalHeartsCaptured: 8,
              trixFirstPlaceCount: 12,
            },
          },
        ]),
      },
    };

    let cacheStore: Record<string, string> = {};
    mockRedis = {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(cacheStore[key] || null)),
      set: vi.fn().mockImplementation((key: string, val: string) => {
        cacheStore[key] = val;
        return Promise.resolve('OK');
      }),
      del: vi.fn().mockImplementation((key: string) => {
        delete cacheStore[key];
        return Promise.resolve(1);
      }),
    };

    service = new LeaderboardService(
      mockPrisma as PrismaService,
      mockRedis as RedisService,
    );
  });

  it('should query database, compute win-rates, and cache result in Redis', async () => {
    const leaderboard = await service.getGlobalLeaderboard(10);

    expect(leaderboard.length).toBe(2);
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[0].displayName).toBe('TopDog');
    expect(leaderboard[0].winRate).toBe(80.0);

    expect(leaderboard[1].rank).toBe(2);
    expect(leaderboard[1].displayName).toBe('RunnerUp');
    expect(leaderboard[1].winRate).toBe(60.0);

    // Verify Redis set was called with 180s TTL
    expect(mockRedis.set).toHaveBeenCalledWith(
      'leaderboard:global',
      expect.any(String),
      180,
    );
  });

  it('should return cached result on subsequent calls without querying database again', async () => {
    // First call populates cache
    await service.getGlobalLeaderboard(10);
    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);

    // Second call should hit Redis cache
    const secondCall = await service.getGlobalLeaderboard(10);
    expect(secondCall.length).toBe(2);
    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1); // Not called again!
  });

  it('should invalidate cache when requested', async () => {
    await service.getGlobalLeaderboard(10);
    await service.invalidateCache();
    expect(mockRedis.del).toHaveBeenCalledWith('leaderboard:global');
  });
});
