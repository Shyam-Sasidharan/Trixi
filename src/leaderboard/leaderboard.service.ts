import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../common/redis/redis.service.js';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  level: number;
  xp: number;
  coins: number;
  isVip: boolean;
  gamesPlayed: number;
  wins: number;
  losses: number;
  soloWins: number;
  teamWins: number;
  winRate: number; // percentage (0 - 100)
  totalQueensCaptured: number;
  totalHeartsCaptured: number;
  trixFirstPlaceCount: number;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  private readonly CACHE_KEY = 'leaderboard:global';
  private readonly CACHE_TTL_SECONDS = 180; // 3-minute cache

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Retrieves top 100 players ordered by wins, win-rate, and level.
   * Utilizes Redis caching with a 3-minute TTL.
   */
  public async getGlobalLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
    // 1. Check Redis cache
    try {
      const cached = await this.redisService.get(this.CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err: any) {
      this.logger.warn(`Redis leaderboard cache read error: ${err.message}`);
    }

    // 2. Query Prisma database
    const users = await this.prisma.user.findMany({
      take: limit,
      include: {
        stats: true,
      },
      orderBy: [
        { stats: { wins: 'desc' } },
        { xp: 'desc' },
        { level: 'desc' },
      ],
    });

    const entries: LeaderboardEntry[] = users.map((u, index) => {
      const games = u.stats?.gamesPlayed || 0;
      const wins = u.stats?.wins || 0;
      const winRate = games > 0 ? parseFloat(((wins / games) * 100).toFixed(1)) : 0;

      return {
        rank: index + 1,
        userId: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        level: u.level,
        xp: u.xp,
        coins: u.coins,
        isVip: u.isVip,
        gamesPlayed: games,
        wins,
        losses: u.stats?.losses || 0,
        soloWins: u.stats?.soloWins || 0,
        teamWins: u.stats?.teamWins || 0,
        winRate,
        totalQueensCaptured: u.stats?.totalQueensCaptured || 0,
        totalHeartsCaptured: u.stats?.totalHeartsCaptured || 0,
        trixFirstPlaceCount: u.stats?.trixFirstPlaceCount || 0,
      };
    });

    // 3. Populate Redis cache with 3-minute TTL
    try {
      await this.redisService.set(
        this.CACHE_KEY,
        JSON.stringify(entries),
        this.CACHE_TTL_SECONDS,
      );
    } catch (err: any) {
      this.logger.warn(`Redis leaderboard cache write error: ${err.message}`);
    }

    return entries;
  }

  /**
   * Retrieves leaderboard filtered by user ID and adjacent neighborhood.
   */
  public async getFriendsLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
    const global = await this.getGlobalLeaderboard(100);
    // Find index of user
    const userIndex = global.findIndex((e) => e.userId === userId);
    if (userIndex === -1) {
      // If user not in top 100, return top 10
      return global.slice(0, 10);
    }

    // Return a window around user
    const start = Math.max(0, userIndex - 5);
    const end = Math.min(global.length, userIndex + 6);
    return global.slice(start, end);
  }

  /**
   * Invalidate leaderboard cache manually (e.g. after tournament or match persist).
   */
  public async invalidateCache(): Promise<void> {
    await this.redisService.del(this.CACHE_KEY);
  }
}
