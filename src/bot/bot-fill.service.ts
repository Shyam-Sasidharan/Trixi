import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { GameRoomService, ActiveGameRoom } from '../game-room/services/game-room.service.js';
import type { GameGateway } from '../game-room/game.gateway.js';
import { BotPersona, getRandomBotPersonas } from './bot-persona.data.js';

export interface BackfillOptions {
  backfillDelayMs?: number; // Delay before starting backfill (default: 6000ms)
  staggerDelayMs?: number; // Delay between bot joins (default: 6000ms)
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
        if (!room.isPrivate && room.allowBots) {
          this.scheduleBackfill(room);
        }
      });
      this.gameRoomService.onRoomDestroyed((roomId: string) => {
        this.cancelBackfill(roomId);
      });
      if (typeof this.gameRoomService.onPlayerJoined === 'function') {
        this.gameRoomService.onPlayerJoined((room: ActiveGameRoom, seat: number, isBot: boolean) => {
          // If a new human joins before 6s, fill that seat with human and reset 6s window for remaining seats
          if (!isBot && room.allowBots && room.status === 'WAITING') {
            const hasEmptySeats = room.players.some((p) => p === null);
            if (hasEmptySeats) {
              this.logger.log(`Human joined room ${room.roomCode}. Resetting 6-second bot backfill timer.`);
              this.scheduleBackfill(room, { backfillDelayMs: 6000, staggerDelayMs: 6000 });
            }
          }
        });
      }
    }
  }

  public setGateway(gateway: GameGateway): void {
    this.gateway = gateway;
  }

  public getGateway(): GameGateway | undefined {
    return this.gateway;
  }

  /**
   * Schedules a 6-second recursive bot backfill timer for a waiting room.
   * If allowBots is false, NEVER adds bots.
   */
  public scheduleBackfill(room: ActiveGameRoom, options?: BackfillOptions): void {
    if (!room || room.status !== 'WAITING') return;
    if (room.allowBots === false) {
      this.logger.log(`Room ${room.roomCode} has allowBots=false; skipping bot backfill.`);
      return;
    }

    this.cancelBackfill(room.roomId);

    if (options?.immediate) {
      this.populateRoomWithBots(room.roomId, true);
      return;
    }

    const delay = options?.backfillDelayMs ?? 6000;

    this.logger.log(
      `Scheduling 6-second bot backfill for Room ${room.roomCode} in ${delay}ms`,
    );

    const timer = setTimeout(() => {
      if (options?.staggerDelayMs !== undefined) {
        this.populateRoomWithBots(room.roomId, false, options.staggerDelayMs);
      } else {
        this.populateNextBot(room.roomId, 6000);
      }
    }, delay);

    this.registerTimer(room.roomId, timer);
  }

  /**
   * Populates a single bot into the next open seat, and if seats remain open,
   * recursively schedules the next bot in staggerDelayMs (default 6000ms).
   */
  private populateNextBot(roomId: string, staggerDelayMs: number = 6000): void {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || room.status !== 'WAITING' || room.allowBots === false) return;

    const openSeat = room.players.findIndex((p) => p === null);
    if (openSeat === -1) {
      this.logger.log(`Room ${room.roomCode} is full; skipping backfill.`);
      return;
    }

    const seatedUserIds = room.players.filter((p) => p !== null).map((p) => p!.userId);
    const [persona] = getRandomBotPersonas(1, seatedUserIds);
    if (!persona) return;

    const result = this.addBotToRoom(room.roomId, persona);
    if (!result) return;

    // If match has not started yet (still open seats), schedule next bot backfill after staggerDelayMs
    if (!result.matchStarted) {
      const stillOpen = room.players.some((p) => p === null);
      if (stillOpen) {
        const nextTimer = setTimeout(() => {
          this.populateNextBot(roomId, staggerDelayMs);
        }, staggerDelayMs);
        this.registerTimer(roomId, nextTimer);
      }
    }
  }

  /**
   * Fills open seats in a room with realistic bot personas (supporting immediate execution or custom stagger).
   */
  public populateRoomWithBots(
    roomId: string,
    immediate: boolean = false,
    customStaggerMs?: number,
  ): void {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || room.status !== 'WAITING' || room.allowBots === false) return;

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

    const staggerMs = customStaggerMs ?? 6000;

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
      `[BOT_JOINED] Room: ${room.roomId}, Seat: ${result.seat}, Bot: ${persona.displayName}, StateVersion: ${room.stateVersion}`,
    );

    // Broadcast WebSocket events if Gateway is connected
    if (this.gateway) {
      if (typeof (this.gateway as any).broadcastLobbyJoinSequence === 'function') {
        (this.gateway as any).broadcastLobbyJoinSequence(room, result.seat, botUser, result.matchStarted);
      } else if (this.gateway.server) {
        // Fallback for mocked gateway in unit tests
        this.gateway.server.to(room.roomId).emit('player_joined', {
          roomId: room.roomId,
          seat: result.seat,
          roomSequence: ++room.roomSequence,
          user: {
            id: persona.id,
            displayName: persona.displayName,
            avatarUrl: persona.avatarUrl,
            level: persona.level,
            coins: persona.coins,
            stats: persona.stats,
          },
        });

        this.gateway.server.to(room.roomId).emit('room_updated', {
          roomId: room.roomId,
          roomSequence: ++room.roomSequence,
          players: room.players
            .filter((p: any) => p !== null)
            .map((p: any) => ({
              seat: p.seat,
              seatIndex: p.seat,
              displayName: p.displayName,
              avatarUrl: p.avatarUrl,
              isHost: p.seat === 0,
              isReady: true,
              isBot: false,
            })),
        });

        if (result.matchStarted) {
          const ownerSeat = room.engine ? room.engine.getActiveKingdom().ownerSeat : 0;
          const currentTurn = room.engine ? room.engine.getState().currentTurnSeat : 0;
          this.gateway.server.to(room.roomId).emit('match_started', {
            roomId: room.roomId,
            gameMode: room.gameMode,
            kingdomType: room.kingdomType,
            firstTurnSeat: currentTurn,
            currentTurnSeat: currentTurn,
            kingdomIndex: 1,
            kingdomOwnerSeat: ownerSeat,
            roomSequence: ++room.roomSequence,
          });

          this.gateway.startRoomTurnTimer(room);
          this.gateway.broadcastMaskedState(room.roomId);
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
