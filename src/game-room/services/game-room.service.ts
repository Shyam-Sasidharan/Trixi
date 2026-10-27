import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TrixEngine } from '../../game-engine/trix-engine.js';
import { Card } from '../../game-engine/types/card.types.js';
import {
  ContractType,
  GameMode,
  KingdomType,
} from '../../game-engine/types/contract.types.js';
import { TrickEngine } from '../../game-engine/trick-engine.js';
import { TrixContract } from '../../game-engine/contracts/trix.contract.js';

export interface ActivePlayer {
  seat: number;
  userId: string;
  socketId: string;
  displayName: string;
  avatarUrl?: string;
  level?: number;
  xp?: number;
  coins?: number;
  stats?: any;
  isConnected: boolean;
  isBot: boolean;
  disconnectTimer?: NodeJS.Timeout;
}

export interface CreateRoomConfig {
  name: string;
  password?: string;
  gameMode?: GameMode;
  kingdomType?: KingdomType;
  turnTime?: number; // 10, 20, 30
  allowSpectators?: boolean;
  isPrivate?: boolean;
}

export interface ActiveGameRoom {
  roomId: string;
  roomCode: string;
  name: string;
  password?: string;
  gameMode: GameMode;
  kingdomType: KingdomType;
  turnTime: number;
  allowSpectators: boolean;
  isPrivate: boolean;
  hostUserId: string;
  createdAt: Date;
  players: (ActivePlayer | null)[];
  status: 'WAITING' | 'STARTING' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';
  engine: TrixEngine | null;
}

@Injectable()
export class GameRoomService {
  private readonly logger = new Logger(GameRoomService.name);
  private rooms: Map<string, ActiveGameRoom> = new Map(); // Keyed by roomId
  private roomCodeToId: Map<string, string> = new Map(); // Keyed by uppercase roomCode
  private socketToRoom: Map<string, { roomId: string; seat: number }> = new Map();
  private userToRoom: Map<string, string> = new Map();
  private onRoomCreatedCallbacks: ((room: ActiveGameRoom) => void)[] = [];
  private onRoomDestroyedCallbacks: ((roomId: string) => void)[] = [];

  constructor(private readonly prisma: PrismaService) {}

  public onRoomCreated(cb: (room: ActiveGameRoom) => void): void {
    this.onRoomCreatedCallbacks.push(cb);
  }

  public onRoomDestroyed(cb: (roomId: string) => void): void {
    this.onRoomDestroyedCallbacks.push(cb);
  }

  /**
   * Generates a unique 6-character alphanumeric room code (e.g., 'TRX9A2').
   */
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Creates a new multiplayer game room with the host occupying Seat 0.
   */
  public createRoom(
    hostUser: { id: string; displayName: string; avatarUrl?: string },
    socketId: string,
    config: CreateRoomConfig,
  ): ActiveGameRoom {
    const existingRoomId = this.userToRoom.get(hostUser.id);
    if (existingRoomId) {
      this.leaveRoom(hostUser.id, existingRoomId);
    }

    const roomId = randomUUID();
    let roomCode = this.generateRoomCode();
    while (this.roomCodeToId.has(roomCode)) {
      roomCode = this.generateRoomCode();
    }

    const players: (ActivePlayer | null)[] = [
      {
        seat: 0,
        userId: hostUser.id,
        socketId,
        displayName: hostUser.displayName || 'Host',
        avatarUrl: hostUser.avatarUrl,
        level: (hostUser as any).level ?? 8,
        xp: (hostUser as any).xp ?? 4500,
        coins: (hostUser as any).coins ?? 2500,
        stats: (hostUser as any).stats ?? {
          gamesPlayed: 30,
          wins: 17,
          losses: 13,
          soloWins: 10,
          teamWins: 7,
          winRate: 56.7,
        },
        isConnected: true,
        isBot: false,
      },
      null,
      null,
      null,
    ];

    const turnTime = config.turnTime && [10, 20, 30].includes(config.turnTime) ? config.turnTime : 20;

    const room: ActiveGameRoom = {
      roomId,
      roomCode,
      name: config.name || `${hostUser.displayName}'s Room`,
      password: config.password,
      gameMode: config.gameMode || 'SOLO',
      kingdomType: config.kingdomType || 'FREE_MERCY',
      turnTime,
      allowSpectators: config.allowSpectators ?? true,
      isPrivate: config.isPrivate ?? false,
      hostUserId: hostUser.id,
      createdAt: new Date(),
      players,
      status: 'WAITING',
      engine: null,
    };

    this.rooms.set(roomId, room);
    this.roomCodeToId.set(roomCode, roomId);
    this.socketToRoom.set(socketId, { roomId, seat: 0 });
    this.userToRoom.set(hostUser.id, roomId);

    for (const cb of this.onRoomCreatedCallbacks) {
      try {
        cb(room);
      } catch (err: any) {
        this.logger.warn(`Error in onRoomCreated callback: ${err.message}`);
      }
    }

    this.logger.log(`Room created: ${room.name} [Code: ${roomCode}, ID: ${roomId}] by User: ${hostUser.id}`);
    return room;
  }

  /**
   * Joins an existing room by roomId or roomCode.
   * If all 4 seats fill, automatically initiates game engine and card deal.
   */
  public joinRoom(
    user: { id: string; displayName: string; avatarUrl?: string },
    socketId: string,
    roomIdOrCode: string,
    password?: string,
  ): { room: ActiveGameRoom; seat: number; matchStarted: boolean } {
    const room = this.getRoom(roomIdOrCode);
    if (!room) {
      throw new NotFoundException(`Room '${roomIdOrCode}' not found`);
    }

    if (room.status === 'FINISHED' || room.status === 'CANCELLED') {
      throw new BadRequestException('This room is no longer active');
    }

    // Password validation if private
    if (room.password && room.password !== password) {
      throw new UnauthorizedException('Incorrect room password');
    }

    // Check if user is already seated in this room
    const existingPlayerIndex = room.players.findIndex((p) => p?.userId === user.id);
    if (existingPlayerIndex !== -1) {
      const player = room.players[existingPlayerIndex]!;
      player.socketId = socketId;
      player.isConnected = true;
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = undefined;
      }
      this.socketToRoom.set(socketId, { roomId: room.roomId, seat: existingPlayerIndex });
      return { room, seat: existingPlayerIndex, matchStarted: room.status === 'IN_PROGRESS' };
    }

    // Check if room is full
    const openSeat = room.players.findIndex((p) => p === null);
    if (openSeat === -1) {
      throw new ConflictException('Room is full (maximum 4 players allowed)');
    }

    const newPlayer: ActivePlayer = {
      seat: openSeat,
      userId: user.id,
      socketId,
      displayName: user.displayName || `Player ${openSeat + 1}`,
      avatarUrl: user.avatarUrl,
      level: (user as any).level ?? 8,
      xp: (user as any).xp ?? 4500,
      coins: (user as any).coins ?? 2500,
      stats: (user as any).stats ?? {
        gamesPlayed: 30,
        wins: 17,
        losses: 13,
        soloWins: 10,
        teamWins: 7,
        winRate: 56.7,
      },
      isConnected: true,
      isBot: (user as any).isBot ?? false,
    };

    room.players[openSeat] = newPlayer;
    this.socketToRoom.set(socketId, { roomId: room.roomId, seat: openSeat });
    this.userToRoom.set(user.id, room.roomId);

    let matchStarted = false;

    // Check if all 4 seats are now filled!
    const allFilled = room.players.every((p) => p !== null);
    if (allFilled && room.status === 'WAITING') {
      room.status = 'IN_PROGRESS';
      room.engine = new TrixEngine(room.gameMode, room.kingdomType);
      matchStarted = true;
      this.logger.log(`Room [${room.roomCode}] full! Match started with 4 players.`);
    }

    return { room, seat: openSeat, matchStarted };
  }

  /**
   * Retrieves an active game room by roomId or roomCode.
   */
  public getRoom(roomIdOrCode: string): ActiveGameRoom | null {
    if (!roomIdOrCode) return null;
    const byId = this.rooms.get(roomIdOrCode);
    if (byId) return byId;

    const idFromCode = this.roomCodeToId.get(roomIdOrCode.toUpperCase());
    if (idFromCode) {
      return this.rooms.get(idFromCode) || null;
    }
    return null;
  }

  /**
   * Finds an active public room waiting for players with at least one open seat.
   */
  public findWaitingPublicRoom(
    gameMode: GameMode,
    kingdomType: KingdomType,
  ): ActiveGameRoom | null {
    for (const room of this.rooms.values()) {
      if (
        !room.isPrivate &&
        !room.password &&
        room.status === 'WAITING' &&
        room.gameMode === gameMode &&
        room.kingdomType === kingdomType
      ) {
        const hasOpenSeat = room.players.some((p) => p === null);
        if (hasOpenSeat) {
          return room;
        }
      }
    }
    return null;
  }

  /**
   * Returns current count of active game rooms.
   */
  public getActiveRoomsCount(): number {
    return this.rooms.size;
  }

  public findRoomBySocketId(socketId: string): { room: ActiveGameRoom; seat: number } | null {
    const mapping = this.socketToRoom.get(socketId);
    if (!mapping) return null;
    const room = this.rooms.get(mapping.roomId);
    if (!room) return null;
    return { room, seat: mapping.seat };
  }

  public findRoomByUserId(userId: string): ActiveGameRoom | null {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  /**
   * Handles player disconnection with a 30-second grace timer.
   */
  public handleDisconnect(
    socketId: string,
    onGraceExpire?: (roomId: string, seat: number) => void,
  ): { roomId: string; seat: number } | null {
    const mapping = this.socketToRoom.get(socketId);
    if (!mapping) return null;

    const room = this.rooms.get(mapping.roomId);
    if (!room) return null;

    const player = room.players[mapping.seat];
    if (player) {
      player.isConnected = false;
      this.logger.warn(`Player ${player.displayName} (Seat ${player.seat}) disconnected from room ${room.roomCode}`);

      // 30-second reconnection grace timer
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
      }

      player.disconnectTimer = setTimeout(() => {
        player.isBot = true;
        this.logger.warn(`Grace timer expired for Seat ${player.seat} in room ${room.roomCode}. Assigned to Bot.`);
        if (onGraceExpire) {
          onGraceExpire(room.roomId, player.seat);
        }
      }, 30000);
    }

    this.socketToRoom.delete(socketId);
    return mapping;
  }

  /**
   * Handles reconnection for a returning player.
   */
  public handleReconnect(
    userId: string,
    newSocketId: string,
  ): { room: ActiveGameRoom; seat: number } | null {
    const room = this.findRoomByUserId(userId);
    if (!room) return null;

    const seat = room.players.findIndex((p) => p?.userId === userId);
    if (seat === -1) return null;

    const player = room.players[seat]!;
    player.socketId = newSocketId;
    player.isConnected = true;
    player.isBot = false;

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = undefined;
    }

    this.socketToRoom.set(newSocketId, { roomId: room.roomId, seat });
    this.logger.log(`Player ${player.displayName} reconnected to Seat ${seat} in room ${room.roomCode}`);

    return { room, seat };
  }

  /**
   * Leaves an active room.
   */
  public leaveRoom(userId: string, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const seatIndex = room.players.findIndex((p) => p?.userId === userId);
    if (seatIndex !== -1) {
      const player = room.players[seatIndex];
      if (player?.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
      }
      this.socketToRoom.delete(player?.socketId || '');
      room.players[seatIndex] = null;
    }

    this.userToRoom.delete(userId);

    // If host left and game hasn't started, cancel room or pass host
    const remainingPlayers = room.players.filter((p) => p !== null);
    if (remainingPlayers.length === 0) {
      this.destroyRoom(roomId);
    }
  }

  /**
   * Destroys an active room and cleans up lookup maps.
   */
  public destroyRoom(roomId: string): void {
    for (const cb of this.onRoomDestroyedCallbacks) {
      try {
        cb(roomId);
      } catch (err: any) {
        this.logger.warn(`Error in onRoomDestroyed callback: ${err.message}`);
      }
    }
    const room = this.rooms.get(roomId);
    if (room) {
      for (const p of room.players) {
        if (p) {
          if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
          this.socketToRoom.delete(p.socketId);
          this.userToRoom.delete(p.userId);
        }
      }
      this.roomCodeToId.delete(room.roomCode);
      this.rooms.delete(roomId);
      this.logger.log(`Room destroyed: ${roomId}`);
    }
  }

  /**
   * Fallback bot auto-play: selects the lowest legal card for a turn timeout or disconnected bot.
   */
  public getFallbackCardToPlay(room: ActiveGameRoom, seat: number): Card | null {
    if (!room.engine) return null;
    const state = room.engine.getState();
    const hand = state.hands[seat] || [];
    if (hand.length === 0) return null;

    if (state.currentPhase === 'TRIX_PLAY') {
      const playable = TrixContract.getPlayableCards(hand, state.trixColumns);
      if (playable.length === 0) return null;
      // Pick lowest power card
      return [...playable].sort((a, b) => a.power - b.power)[0];
    }

    if (state.currentPhase === 'TRICK_PLAY') {
      const legalCards = hand.filter(
        (c) =>
          TrickEngine.validatePlay(
            hand,
            c,
            state.currentTrick,
            state.brokenSuits,
            state.activeContracts,
            state.kingdomType,
          ).valid,
      );
      if (legalCards.length === 0) return hand[0];
      // Pick lowest power card
      return [...legalCards].sort((a, b) => a.power - b.power)[0];
    }

    return null;
  }

  /**
   * Persists completed match to PostgreSQL (MatchHistory, MatchParticipant, and UserStats).
   */
  public async saveMatchHistory(room: ActiveGameRoom): Promise<void> {
    if (!room.engine) return;
    const state = room.engine.getState();

    // Determine highest score as winning score
    const scores = state.scores;
    let maxScore = -Infinity;
    for (let s = 0; s < 4; s++) {
      if (scores[s] > maxScore) {
        maxScore = scores[s];
      }
    }

    try {
      if (this.prisma && this.prisma.matchHistory) {
        const match = await this.prisma.matchHistory.create({
          data: {
            roomId: room.roomId,
            gameMode: room.gameMode,
            kingdomType: room.kingdomType,
            winningScore: maxScore,
            playerScores: scores as any,
            participants: {
              create: room.players.map((p, idx) => ({
                seatIndex: idx,
                finalScore: scores[idx] ?? 0,
                isWinner: scores[idx] === maxScore,
                userId: p?.userId ?? '00000000-0000-0000-0000-000000000000',
              })),
            },
          },
        });

        // Update stats and award coins/XP for registered players
        for (let s = 0; s < 4; s++) {
          const player = room.players[s];
          if (!player || player.userId.startsWith('00000000')) continue;

          const isWin = scores[s] === maxScore;
          const coinDelta = isWin ? 120 : -80;
          const xpGain = 50;

          try {
            await this.prisma.user.update({
              where: { id: player.userId },
              data: {
                xp: { increment: xpGain },
                coins: { increment: coinDelta },
                stats: {
                  update: {
                    gamesPlayed: { increment: 1 },
                    wins: isWin ? { increment: 1 } : undefined,
                    losses: !isWin ? { increment: 1 } : undefined,
                    soloWins: isWin && room.gameMode === 'SOLO' ? { increment: 1 } : undefined,
                    teamWins: isWin && room.gameMode === 'TEAM' ? { increment: 1 } : undefined,
                  },
                },
              },
            });
          } catch (statErr: any) {
            this.logger.warn(`Could not update stats for player ${player.userId}: ${statErr.message}`);
          }
        }
        this.logger.log(`Match persisted successfully: ${match.id}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to save match history: ${err.message}`, err.stack);
    }
  }
}
