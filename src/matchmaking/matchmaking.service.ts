import { forwardRef, Inject, Injectable, Logger, Optional, OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service.js';
import { GameRoomService, ActiveGameRoom } from '../game-room/services/game-room.service.js';
import { GameMode, KingdomType } from '../game-engine/types/contract.types.js';
import { BotFillService } from '../bot/bot-fill.service.js';
import type { GameGateway } from '../game-room/game.gateway.js';

export interface QueuePlayer {
  userId: string;
  socketId: string;
  displayName: string;
  avatarUrl?: string;
  level?: number;
  coins?: number;
  stats?: any;
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
export class MatchmakingService implements OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingService.name);
  // In-memory fallback queue when Redis is offline or in mock test environment
  private memoryQueues: Map<string, QueuePlayer[]> = new Map();
  private userToQueueKey: Map<string, string> = new Map();
  private countdownTimers: Map<string, NodeJS.Timeout> = new Map();
  private gateway?: GameGateway;

  constructor(
    private readonly redisService: RedisService,
    private readonly gameRoomService: GameRoomService,
    @Optional()
    @Inject(forwardRef(() => BotFillService))
    private botFillService?: BotFillService,
  ) {}

  public setGateway(gateway: GameGateway): void {
    this.gateway = gateway;
  }

  public setBotFillService(botFillService: BotFillService): void {
    this.botFillService = botFillService;
  }

  public getQueueKey(gameMode: GameMode, kingdomType: KingdomType): string {
    return `trix_queue:${gameMode}:${kingdomType}`;
  }

  /**
   * Adds a player to the matchmaking queue for specified mode and kingdom type.
   * If 4 players are accumulated, automatically forms an official room immediately.
   * If < 4 players, starts a 6-second countdown timer to group incoming humans.
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
      level: (user as any).level ?? 8,
      coins: (user as any).coins ?? 2500,
      stats: (user as any).stats,
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
          this.clearCountdownTimer(queueKey);
          const popped = await this.popQueuePlayers(queueKey, 4);
          if (popped.length === 4) {
            return this.createMatchRoom(popped, gameMode, kingdomType);
          }
        } else {
          // If queue length < 4, start 6-second countdown timer if not already running
          if (!this.countdownTimers.has(queueKey)) {
            this.logger.log(`Starting 6-second matchmaking timer for [${queueKey}]`);
            const timer = setTimeout(async () => {
              try {
                await this.handleQueueTimeout(queueKey, gameMode, kingdomType);
              } catch (err: any) {
                this.logger.error(`Error in matchmaking timeout: ${err.message}`);
              }
            }, 6000);
            this.countdownTimers.set(queueKey, timer);
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
      this.clearCountdownTimer(queueKey);
      const popped = q.splice(0, 4);
      for (const p of popped) {
        this.userToQueueKey.delete(p.userId);
      }
      return this.createMatchRoom(popped, gameMode, kingdomType);
    } else {
      if (!this.countdownTimers.has(queueKey)) {
        this.logger.log(`Starting 6-second in-memory matchmaking timer for [${queueKey}]`);
        const timer = setTimeout(async () => {
          try {
            await this.handleQueueTimeout(queueKey, gameMode, kingdomType);
          } catch (err: any) {
            this.logger.error(`Error in matchmaking timeout: ${err.message}`);
          }
        }, 6000);
        this.countdownTimers.set(queueKey, timer);
      }
    }

    return { matchFound: false };
  }

  /**
   * Handles 6-second queue expiration: groups all waiting human players (1, 2, or 3)
   * into a room, and calls BotFillService to populate only the remaining empty seats with disguised bots.
   */
  public async handleQueueTimeout(
    queueKey: string,
    gameMode: GameMode,
    kingdomType: KingdomType,
  ): Promise<MatchFoundResult | null> {
    this.clearCountdownTimer(queueKey);

    const players = await this.popQueuePlayers(queueKey, 4);
    if (players.length === 0) {
      return null;
    }

    if (players.length === 4) {
      return this.createMatchRoom(players, gameMode, kingdomType);
    }

    // 1, 2, or 3 human players: group them into a room together
    const host = players[0];
    const room = this.gameRoomService.createRoom(
      { id: host.userId, displayName: host.displayName, avatarUrl: host.avatarUrl },
      host.socketId,
      {
        name: `Match ${gameMode} - ${kingdomType}`,
        gameMode,
        kingdomType,
        turnTime: 20,
        isPrivate: false,
      },
    );

    // Join remaining human players (seats 1, 2, etc.)
    for (let i = 1; i < players.length; i++) {
      const p = players[i];
      this.gameRoomService.joinRoom(
        { id: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl },
        p.socketId,
        room.roomId,
      );
    }

    this.logger.log(
      `Queue timeout for [${queueKey}]: formed match with ${players.length} human player(s) [Room ID: ${room.roomId}, Code: ${room.roomCode}]. Populating remaining seats with bots.`,
    );

    // Connect human sockets to the room channel and broadcast room_updated
    if (this.gateway?.server) {
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const sock = this.gateway.server.sockets.sockets.get(p.socketId);
        if (sock) {
          sock.join(room.roomId);
        }
        this.gateway.server.to(p.socketId).emit('match_found', {
          roomId: room.roomId,
          roomCode: room.roomCode,
          seat: i,
        });
      }
      if (typeof this.gateway.broadcastRoomUpdated === 'function') {
        this.gateway.broadcastRoomUpdated(room.roomId);
      }
    }

    // Call BotFillService to populate ONLY the remaining empty seats with disguised bot personas with 800ms delays
    if (this.botFillService) {
      this.botFillService.populateRoomWithBots(room.roomId, false, 800);
    }

    return {
      matchFound: true,
      room,
      players,
    };
  }

  /**
   * Removes a player from their active matchmaking queue.
   */
  public async dequeue(userId: string): Promise<boolean> {
    const queueKey = this.userToQueueKey.get(userId);
    if (!queueKey) return false;

    this.userToQueueKey.delete(userId);
    let dequeued = false;

    const redis = this.redisService?.getClient();
    if (redis && redis.status === 'ready') {
      try {
        const items = await redis.lrange(queueKey, 0, -1);
        for (const item of items) {
          const parsed: QueuePlayer = JSON.parse(item);
          if (parsed.userId === userId) {
            await redis.lrem(queueKey, 1, item);
            this.logger.log(`Dequeued player ${userId} from Redis queue [${queueKey}]`);
            dequeued = true;
            break;
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
        dequeued = true;
      }
    }

    // If queue is now empty, cancel any pending countdown timer
    const remaining = await this.getQueueLength(queueKey);
    if (remaining === 0) {
      this.clearCountdownTimer(queueKey);
    }

    return dequeued;
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
        isPrivate: false,
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

    if (this.gateway?.server) {
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const sock = this.gateway.server.sockets.sockets.get(p.socketId);
        if (sock) {
          sock.join(room.roomId);
        }
        this.gateway.server.to(p.socketId).emit('match_found', {
          roomId: room.roomId,
          roomCode: room.roomCode,
          seat: i,
        });
      }
      if (typeof this.gateway.broadcastRoomUpdated === 'function') {
        this.gateway.broadcastRoomUpdated(room.roomId);
      }
      this.gateway.server.to(room.roomId).emit('match_started', {
        roomId: room.roomId,
        gameMode: room.gameMode,
        kingdomType: room.kingdomType,
      });
      this.gateway.startRoomTurnTimer(room);
      this.gateway.broadcastMaskedState(room.roomId);
    }

    return {
      matchFound: true,
      room,
      players,
    };
  }

  /**
   * Pops up to maxCount players from specified queue.
   */
  public async popQueuePlayers(queueKey: string, maxCount: number): Promise<QueuePlayer[]> {
    const popped: QueuePlayer[] = [];
    const redis = this.redisService?.getClient();
    if (redis && redis.status === 'ready') {
      try {
        for (let i = 0; i < maxCount; i++) {
          const raw = await redis.lpop(queueKey);
          if (raw) {
            const p: QueuePlayer = JSON.parse(raw);
            this.userToQueueKey.delete(p.userId);
            popped.push(p);
          } else {
            break;
          }
        }
        return popped;
      } catch (err: any) {
        this.logger.warn(`Redis popQueuePlayers error: ${err.message}`);
      }
    }

    const q = this.memoryQueues.get(queueKey);
    if (q) {
      const count = Math.min(maxCount, q.length);
      const items = q.splice(0, count);
      for (const p of items) {
        this.userToQueueKey.delete(p.userId);
      }
      popped.push(...items);
    }

    return popped;
  }

  /**
   * Returns length of queue in Redis or memory.
   */
  public async getQueueLength(queueKey: string): Promise<number> {
    const redis = this.redisService?.getClient();
    if (redis && redis.status === 'ready') {
      try {
        return await redis.llen(queueKey);
      } catch (err: any) {
        this.logger.warn(`Redis llen error: ${err.message}`);
      }
    }
    return this.memoryQueues.get(queueKey)?.length ?? 0;
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

  public clearCountdownTimer(queueKey: string): void {
    const timer = this.countdownTimers.get(queueKey);
    if (timer) {
      clearTimeout(timer);
      this.countdownTimers.delete(queueKey);
    }
  }

  public clearAllTimers(): void {
    for (const timer of this.countdownTimers.values()) {
      clearTimeout(timer);
    }
    this.countdownTimers.clear();
  }

  public hasActiveTimer(gameMode: GameMode, kingdomType: KingdomType): boolean {
    const queueKey = this.getQueueKey(gameMode, kingdomType);
    return this.countdownTimers.has(queueKey);
  }

  public onModuleDestroy(): void {
    this.clearAllTimers();
  }
}
