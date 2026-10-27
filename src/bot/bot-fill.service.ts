import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { GameRoomService, ActiveGameRoom } from '../game-room/services/game-room.service.js';
import type { GameGateway } from '../game-room/game.gateway.js';
import { BotPersona, getRandomBotPersonas } from './bot-persona.data.js';

export interface BackfillOptions {
  backfillDelayMs?: number; // Delay before starting backfill (default: 3500ms - 5000ms)
  staggerDelayMs?: number; // Base delay between bot joins (default: 800ms - 1100ms)
  immediate?: boolean; // For synchronous/instant execution in tests
}

@Injectable()
export class BotFillService {
  private readonly logger = new Logger(BotFillService.name);
  private backfillTimers: Map<string, NodeJS.Timeout[]> = new Map();
  private gateway?: GameGateway;

  constructor(
    @Inject(forwardRef(() => GameRoomService))
    private readonly gameRoomService: GameRoomService,
  ) {
    if (this.gameRoomService && typeof this.gameRoomService.onRoomCreated === 'function') {
      this.gameRoomService.onRoomCreated((room: ActiveGameRoom) => {
        if (!room.isPrivate) {
          this.scheduleBackfill(room);
        }
      });
      this.gameRoomService.onRoomDestroyed((roomId: string) => {
        this.cancelBackfill(roomId);
      });
    }
  }

  public setGateway(gateway: GameGateway): void {
    this.gateway = gateway;
  }

  /**
   * Schedules a backfill timer for a waiting room.
   * If the room is not full when the timer expires, bot personas are selected and join with staggered delays.
   */
  public scheduleBackfill(room: ActiveGameRoom, options?: BackfillOptions): void {
    if (!room || room.status !== 'WAITING') return;

    this.cancelBackfill(room.roomId);

    if (options?.immediate) {
      this.populateRoomWithBots(room.roomId, true);
      return;
    }

    const delay =
      options?.backfillDelayMs ??
      Math.floor(3500 + Math.random() * 1500); // 3.5s - 5.0s window

    this.logger.log(
      `Scheduling bot backfill for Room ${room.roomCode} in ${delay}ms`,
    );

    const timer = setTimeout(() => {
      this.populateRoomWithBots(room.roomId, false, options?.staggerDelayMs);
    }, delay);

    this.registerTimer(room.roomId, timer);
  }

  /**
   * Immediately fills all open seats in a room with realistic bot personas.
   */
  public populateRoomWithBots(
    roomId: string,
    immediate: boolean = false,
    customStaggerMs?: number,
  ): void {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || room.status !== 'WAITING') return;

    const openSeats: number[] = [];
    const seatedUserIds: string[] = [];

    for (let s = 0; s < 4; s++) {
      const p = room.players[s];
      if (p === null) {
        openSeats.push(s);
      } else {
        seatedUserIds.push(p.userId);
      }
    }

    const neededCount = openSeats.length;
    if (neededCount === 0) {
      this.logger.log(`Room ${room.roomCode} is already full; skipping backfill.`);
      return;
    }

    const personas = getRandomBotPersonas(neededCount, seatedUserIds);

    this.logger.log(
      `Backfilling Room ${room.roomCode} with ${neededCount} bots: [${personas.map((p) => p.displayName).join(', ')}]`,
    );

    if (immediate) {
      for (const persona of personas) {
        this.addBotToRoom(room.roomId, persona);
      }
      return;
    }

    // Stagger their entry (+800ms, +1600ms, +2400ms) with 800ms intervals
    const staggerMs = customStaggerMs ?? 800;

    personas.forEach((persona, index) => {
      const joinDelay = (index + 1) * staggerMs;

      const staggerTimer = setTimeout(() => {
        this.addBotToRoom(roomId, persona);
      }, joinDelay);

      this.registerTimer(roomId, staggerTimer);
    });
  }

  /**
   * Adds a single bot persona to the room via standard joinRoom.
   */
  public addBotToRoom(
    roomId: string,
    persona: BotPersona,
  ): { seat: number; matchStarted: boolean } | null {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || room.status === 'FINISHED' || room.status === 'CANCELLED') {
      return null;
    }

    // Check if room is already full
    const openSeat = room.players.findIndex((p: any) => p === null);
    if (openSeat === -1) {
      return null;
    }

    const botUser = {
      id: persona.id,
      displayName: persona.displayName,
      avatarUrl: persona.avatarUrl,
      level: persona.level,
      xp: persona.xp,
      coins: persona.coins,
      stats: persona.stats,
      isBot: true, // Marked internally as bot; client view disguises this
    };

    const botSocketId = `bot-socket-${persona.id.slice(0, 8)}`;

    const result = this.gameRoomService.joinRoom(botUser, botSocketId, roomId);

    this.logger.log(
      `Bot ${persona.displayName} seated at Seat ${result.seat} in Room ${room.roomCode} (MatchStarted: ${result.matchStarted})`,
    );

    // Broadcast WebSocket events if Gateway is connected
    if (this.gateway) {
      // 1. The bot persona is assigned with isConnected: true (set in joinRoom)
      // 2. The server MUST immediately broadcast room_updated to the room channel
      if (typeof this.gateway.broadcastRoomUpdated === 'function') {
        this.gateway.broadcastRoomUpdated(room.roomId);
      } else if (this.gateway.server) {
        this.gateway.server.to(room.roomId).emit('room_updated', {
          roomId: room.roomId,
          players: room.players
            .filter((p: any) => p !== null)
            .map((p: any) => ({
              seat: p.seat,
              seatIndex: p.seat,
              displayName: p.displayName,
              avatarUrl: p.avatarUrl,
              isHost: p.seat === 0,
              isReady: true,
            })),
        });
      }

      if (this.gateway.server) {
        if (result.matchStarted) {
          // As soon as Seat 3 (the 4th player) is filled:
          // Instantiates TrixEngine match & deals cards (in joinRoom)
          // Emit match_started and dispatch broadcastMaskedState(roomId)
          this.gateway.server.to(room.roomId).emit('match_started', {
            roomId: room.roomId,
            gameMode: room.gameMode,
            kingdomType: room.kingdomType,
          });

          this.gateway.startRoomTurnTimer(room);
          this.gateway.broadcastMaskedState(room.roomId);
        } else {
          this.gateway.server.to(room.roomId).emit('player_joined', {
            roomId: room.roomId,
            seat: result.seat,
            user: {
              id: persona.id,
              displayName: persona.displayName,
              avatarUrl: persona.avatarUrl,
              level: persona.level,
              coins: persona.coins,
              stats: persona.stats,
            },
          });
        }
      }
    }

    return { seat: result.seat, matchStarted: result.matchStarted };
  }

  /**
   * Cancels all pending backfill or stagger timers for a room.
   */
  public cancelBackfill(roomId: string): void {
    const timers = this.backfillTimers.get(roomId);
    if (timers) {
      for (const t of timers) {
        clearTimeout(t);
      }
      this.backfillTimers.delete(roomId);
    }
  }

  private registerTimer(roomId: string, timer: NodeJS.Timeout): void {
    if (!this.backfillTimers.has(roomId)) {
      this.backfillTimers.set(roomId, []);
    }
    this.backfillTimers.get(roomId)!.push(timer);
  }
}
