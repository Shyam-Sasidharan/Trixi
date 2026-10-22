import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service.js';
import { GameRoomService, ActiveGameRoom } from '../game-room/services/game-room.service.js';
import { GameMode, KingdomType } from '../game-engine/types/contract.types.js';

export interface QueuePlayer {
  userId: string;
  socketId: string;
  displayName: string;
  avatarUrl?: string;
  gameMode: GameMode;
  kingdomType: KingdomType;
  enqueuedAt: number;
}

export interface MatchFoundResult {
  matchFound: boolean;
  room?: ActiveGameRoom;
  players?: QueuePlayer[];
}

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);
  // In-memory fallback queue when Redis is offline or in mock test environment
  private memoryQueues: Map<string, QueuePlayer[]> = new Map();
  private userToQueueKey: Map<string, string> = new Map();

  constructor(
    private readonly redisService: RedisService,
    private readonly gameRoomService: GameRoomService,
  ) {}

  private getQueueKey(gameMode: GameMode, kingdomType: KingdomType): string {
    return `trix_matchmaking_queue:${gameMode}:${kingdomType}`;
  }

  /**
   * Adds a player to the matchmaking queue for specified mode and kingdom type.
   * If 4 players are accumulated, automatically forms an official room.
   */
  public async enqueue(
    user: { id: string; displayName: string; avatarUrl?: string },
    socketId: string,
    gameMode: GameMode = 'SOLO',
    kingdomType: KingdomType = 'FREE_MERCY',
  ): Promise<MatchFoundResult> {
    const queueKey = this.getQueueKey(gameMode, kingdomType);

    // Remove user if already queued elsewhere
    await this.dequeue(user.id);

    const playerItem: QueuePlayer = {
      userId: user.id,
      socketId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      gameMode,
      kingdomType,
      enqueuedAt: Date.now(),
    };

    const redis = this.redisService?.getClient();
    const isRedisReady = redis && redis.status === 'ready';

    if (isRedisReady) {
      try {
        await redis.rpush(queueKey, JSON.stringify(playerItem));
        this.userToQueueKey.set(user.id, queueKey);

        const length = await redis.llen(queueKey);
        this.logger.log(`Matchmaking queue [${queueKey}] size: ${length}`);

        if (length >= 4) {
          // Atomically pop 4 players
          const popped: QueuePlayer[] = [];
          for (let i = 0; i < 4; i++) {
            const raw = await redis.lpop(queueKey);
            if (raw) {
              popped.push(JSON.parse(raw));
            }
          }

          if (popped.length === 4) {
            return this.createMatchRoom(popped, gameMode, kingdomType);
          }
        }

        return { matchFound: false };
      } catch (err: any) {
        this.logger.warn(`Redis enqueue failed: ${err.message}. Falling back to in-memory queue.`);
      }
    }

    // In-memory fallback
    if (!this.memoryQueues.has(queueKey)) {
      this.memoryQueues.set(queueKey, []);
    }
    const q = this.memoryQueues.get(queueKey)!;
    q.push(playerItem);
    this.userToQueueKey.set(user.id, queueKey);

    this.logger.log(`In-memory queue [${queueKey}] size: ${q.length}`);

    if (q.length >= 4) {
      const popped = q.splice(0, 4);
      for (const p of popped) {
        this.userToQueueKey.delete(p.userId);
      }
      return this.createMatchRoom(popped, gameMode, kingdomType);
    }

    return { matchFound: false };
  }

  /**
   * Removes a player from their active matchmaking queue.
   */
  public async dequeue(userId: string): Promise<boolean> {
    const queueKey = this.userToQueueKey.get(userId);
    if (!queueKey) return false;

    this.userToQueueKey.delete(userId);

    const redis = this.redisService?.getClient();
    if (redis && redis.status === 'ready') {
      try {
        const items = await redis.lrange(queueKey, 0, -1);
        for (const item of items) {
          const parsed: QueuePlayer = JSON.parse(item);
          if (parsed.userId === userId) {
            await redis.lrem(queueKey, 1, item);
            this.logger.log(`Dequeued player ${userId} from Redis queue [${queueKey}]`);
            return true;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Redis dequeue error: ${err.message}`);
      }
    }

    const q = this.memoryQueues.get(queueKey);
    if (q) {
      const idx = q.findIndex((p) => p.userId === userId);
      if (idx !== -1) {
        q.splice(idx, 1);
        this.logger.log(`Dequeued player ${userId} from memory queue [${queueKey}]`);
        return true;
      }
    }

    return false;
  }

  /**
   * Helper to instantiate a 4-player match room and populate all seats.
   */
  private createMatchRoom(
    players: QueuePlayer[],
    gameMode: GameMode,
    kingdomType: KingdomType,
  ): MatchFoundResult {
    const host = players[0];
    const room = this.gameRoomService.createRoom(
      { id: host.userId, displayName: host.displayName, avatarUrl: host.avatarUrl },
      host.socketId,
      {
        name: `Match ${gameMode} - ${kingdomType}`,
        gameMode,
        kingdomType,
        turnTime: 20,
      },
    );

    // Join remaining 3 players
    for (let i = 1; i < players.length; i++) {
      const p = players[i];
      this.gameRoomService.joinRoom(
        { id: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl },
        p.socketId,
        room.roomId,
      );
    }

    this.logger.log(`Matchmaking created 4-player match! Room ID: ${room.roomId}, Code: ${room.roomCode}`);

    return {
      matchFound: true,
      room,
      players,
    };
  }

  /**
   * Returns current queue position and estimated wait time.
   */
  public async getQueueStatus(userId: string): Promise<{ inQueue: boolean; position?: number }> {
    const queueKey = this.userToQueueKey.get(userId);
    if (!queueKey) {
      return { inQueue: false };
    }

    const redis = this.redisService?.getClient();
    if (redis && redis.status === 'ready') {
      try {
        const items = await redis.lrange(queueKey, 0, -1);
        const idx = items.findIndex((raw) => JSON.parse(raw).userId === userId);
        return { inQueue: idx !== -1, position: idx !== -1 ? idx + 1 : undefined };
      } catch {
        // Fallback
      }
    }

    const q = this.memoryQueues.get(queueKey);
    if (q) {
      const idx = q.findIndex((p) => p.userId === userId);
      return { inQueue: idx !== -1, position: idx !== -1 ? idx + 1 : undefined };
    }

    return { inQueue: false };
  }
}
