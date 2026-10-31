import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  forwardRef,
  Inject,
  Logger,
  Optional,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GameRoomService, ActiveGameRoom, ActivePlayer } from './services/game-room.service.js';
import { RoomTimerService, TimerTickEvent } from './services/room-timer.service.js';
import { PlayerViewSerializer, PlayerSeatInfo } from './serializers/player-view.serializer.js';
import { ContractType, GameMode, KingdomType } from '../game-engine/types/contract.types.js';
import { Card } from '../game-engine/types/card.types.js';
import { TrickEngine } from '../game-engine/trick-engine.js';
import { TrixContract } from '../game-engine/contracts/trix.contract.js';
import { BotActionService } from '../bot/bot-action.service.js';
import { BotFillService } from '../bot/bot-fill.service.js';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';

interface SocketUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  level?: number;
  coins?: number;
  stats?: any;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  pingTimeout: 30000,
  pingInterval: 10000,
  connectTimeout: 20000,
  maxHttpBufferSize: 1e6,
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GameGateway.name);
  private roomLocks: Map<string, Promise<any>> = new Map();
  private socketToRooms: Map<string, Set<string>> = new Map();

  constructor(
    public readonly gameRoomService: GameRoomService,
    private readonly roomTimerService: RoomTimerService,
    private readonly jwtService: JwtService,
    @Optional()
    @Inject(forwardRef(() => BotActionService))
    private readonly botActionService?: BotActionService,
    @Optional()
    @Inject(forwardRef(() => BotFillService))
    private readonly botFillService?: BotFillService,
    @Optional()
    @Inject(forwardRef(() => MatchmakingService))
    private readonly matchmakingService?: MatchmakingService,
  ) {
    if (this.botActionService) this.botActionService.setGateway(this);
    if (this.botFillService) this.botFillService.setGateway(this);
    if (this.matchmakingService) this.matchmakingService.setGateway(this);

    if (this.gameRoomService && typeof this.gameRoomService.onRoomDestroyed === 'function') {
      this.gameRoomService.onRoomDestroyed((roomId) => {
        this.roomTimerService.stopTimer(roomId);
        this.botActionService?.cancelPendingActions(roomId);
      });
    }
  }

  afterInit(server: Server) {
    if (this.botActionService) this.botActionService.setGateway(this);
    if (this.botFillService) this.botFillService.setGateway(this);
    if (this.matchmakingService) this.matchmakingService.setGateway(this);
  }

  public trackSocketRoom(client: Socket, roomId: string): void {
    client.join(roomId);
    let rooms = this.socketToRooms.get(client.id);
    if (!rooms) {
      rooms = new Set();
      this.socketToRooms.set(client.id, rooms);
    }
    rooms.add(roomId);
  }

  public leaveAllRoomsForSocket(client: Socket, userId?: string, keepRoomId?: string): void {
    const rooms = this.socketToRooms.get(client.id);
    if (rooms) {
      for (const rId of rooms) {
        if (keepRoomId && (rId === keepRoomId || rId.toUpperCase() === keepRoomId.toUpperCase())) continue;
        client.leave(rId);
        if (userId) {
          this.gameRoomService.leaveRoom(userId, rId);
        }
        rooms.delete(rId);
      }
      if (rooms.size === 0) {
        this.socketToRooms.delete(client.id);
      }
    }

    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (mapping && (!keepRoomId || (mapping.room.roomId !== keepRoomId && mapping.room.roomCode !== keepRoomId.toUpperCase()))) {
      client.leave(mapping.room.roomId);
      if (userId) {
        this.gameRoomService.leaveRoom(userId, mapping.room.roomId);
      }
    }
  }

  public leaveAllSocketChannels(client: Socket, keepRoomId?: string): void {
    const rooms = this.socketToRooms.get(client.id);
    if (rooms) {
      for (const rId of rooms) {
        if (keepRoomId && (rId === keepRoomId || rId.toUpperCase() === keepRoomId.toUpperCase())) continue;
        client.leave(rId);
        rooms.delete(rId);
      }
      if (rooms.size === 0) {
        this.socketToRooms.delete(client.id);
      }
    }
  }

  /**
   * Broadcasts strictly sequential join sequence:
   * player_joined -> room_updated -> match_started (if matchStarted) -> game_state
   */
  public broadcastLobbyJoinSequence(
    room: ActiveGameRoom,
    seat: number,
    user: any,
    matchStarted: boolean,
  ): void {
    if (!this.server) return;

    // 1. player_joined (for every seat, including Seat 3 / 4th player)
    this.server.to(room.roomId).emit('player_joined', {
      roomId: room.roomId,
      seat,
      roomSequence: ++room.roomSequence,
      user: {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        level: user.level ?? 8,
        coins: user.coins ?? 2500,
        stats: user.stats ?? {
          gamesPlayed: 30,
          wins: 17,
          losses: 13,
          soloWins: 10,
          teamWins: 7,
          winRate: 56.7,
        },
      },
    });

    // 2. room_updated (complete 4-seat snapshot)
    this.broadcastRoomUpdated(room.roomId);

    // 3. If matchStarted: emit match_started -> game_state
    if (matchStarted) {
      this.triggerMatchStart(room);
    }
  }

  /**
   * Automatically triggers match start, deals cards, starts turn timer, and broadcasts masked state.
   */
  public triggerMatchStart(room: ActiveGameRoom): void {
    if (!this.server) return;

    this.server.to(room.roomId).emit('match_started', {
      roomId: room.roomId,
      gameMode: room.gameMode,
      kingdomType: room.kingdomType,
      firstTurnSeat: room.engine ? room.engine.getState().currentTurnSeat : 0,
      currentTurnSeat: room.engine ? room.engine.getState().currentTurnSeat : 0,
      kingdomIndex: 1,
      kingdomOwnerSeat: room.engine ? room.engine.getActiveKingdom().ownerSeat : 0,
      roomSequence: ++room.roomSequence,
    });

    this.startRoomTurnTimer(room);
    this.broadcastMaskedState(room.roomId);
  }

  /**
   * Serializes operations per room to prevent race conditions during rapid card plays.
   */
  private async runWithRoomLock<T>(roomId: string, fn: () => Promise<T> | T): Promise<T> {
    const prevLock = this.roomLocks.get(roomId) || Promise.resolve();
    let release: () => void;
    const currentLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.roomLocks.set(roomId, prevLock.then(() => currentLock));

    try {
      await prevLock;
      return await fn();
    } finally {
      release!();
    }
  }

  /**
   * Validates JWT token from handshake auth or headers, attaching user to socket.
   */
  async handleConnection(client: Socket) {
    try {
      const authHeader =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization;

      let token: string | undefined;
      if (typeof authHeader === 'string') {
        token = authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader;
      }

      if (token && this.jwtService) {
        const secret =
          process.env.JWT_SECRET || 'trix-secret-key-change-in-production';
        const payload = await this.jwtService.verifyAsync(token, { secret });
        client.data.user = {
          id: payload.sub,
          email: payload.email || `${payload.phoneNumber || payload.sub}@trix.local`,
          displayName:
            payload.displayName ||
            (payload.email ? payload.email.split('@')[0] : payload.phoneNumber) ||
            'Player',
          avatarUrl: payload.avatarUrl,
        } as SocketUser;
      } else {
        // Fallback for tests or guest socket connections
        const guestId = (client.handshake.query?.userId as string) || `guest-${client.id.slice(0, 6)}`;
        const guestName = (client.handshake.query?.displayName as string) || `Guest ${client.id.slice(0, 4)}`;
        client.data.user = {
          id: guestId,
          email: `${guestId}@trix.local`,
          displayName: guestName,
        } as SocketUser;
      }

      this.logger.log(`Socket connected: ${client.id} [User: ${client.data.user.displayName}]`);
    } catch (err: any) {
      this.logger.warn(`Auth handshake failed for socket ${client.id}: ${err.message}`);
      // Assign fallback guest rather than dropping immediately
      const guestId = `guest-${client.id.slice(0, 6)}`;
      client.data.user = {
        id: guestId,
        email: `${guestId}@trix.local`,
        displayName: `Guest ${client.id.slice(0, 4)}`,
      } as SocketUser;
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket disconnected: ${client.id}`);
    if (this.matchmakingService && client.data?.user?.id) {
      this.matchmakingService.dequeue(client.data.user.id).catch(() => {});
    }
    const disconnected = this.gameRoomService.handleDisconnect(client.id, (roomId, seat) => {
      // Called when 30s grace timer expires and seat becomes bot
      this.broadcastMaskedState(roomId);
    });

    if (disconnected) {
      this.broadcastRoomUpdated(disconnected.roomId);
      this.broadcastMaskedState(disconnected.roomId);
    }

    this.leaveAllSocketChannels(client);
    this.socketToRooms.delete(client.id);
  }

  public broadcastRoomUpdated(roomId: string): void {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room) return;

    this.server.to(roomId).emit('room_updated', {
      roomId,
      roomSequence: ++room.roomSequence,
      players: room.players
        .filter((p): p is ActivePlayer => p !== null)
        .map((p) => ({
          seat: p.seat,
          seatIndex: p.seat,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          isHost: p.seat === 0,
          isReady: true,
          isBot: false,
        })),
    });
  }

  private getUserFromSocket(client: Socket): SocketUser {
    return client.data?.user || {
      id: client.id,
      email: `${client.id}@trix.local`,
      displayName: `Player ${client.id.slice(0, 4)}`,
    };
  }

  @SubscribeMessage('create_room')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      name?: string;
      password?: string;
      gameMode?: GameMode;
      kingdomType?: KingdomType;
      turnTime?: number;
      allowSpectators?: boolean;
      isPrivate?: boolean;
      allowBots?: boolean;
    },
  ) {
    const user = this.getUserFromSocket(client);
    const gameMode = data?.gameMode || 'SOLO';
    const kingdomType = data?.kingdomType || 'FREE_MERCY';
    const allowBots = data?.allowBots ?? (!data?.isPrivate);

    // Leave any old room channel
    this.leaveAllRoomsForSocket(client, user.id);

    // If public room without password, check if there is an existing waiting public room matching criteria
    if (!data?.isPrivate && !data?.password) {
      const existingRoom = this.gameRoomService.findWaitingPublicRoom(gameMode, kingdomType, allowBots);
      if (existingRoom) {
        const result = this.gameRoomService.joinRoom(user, client.id, existingRoom.roomId);
        this.trackSocketRoom(client, existingRoom.roomId);

        // BE-07 Strict sequential join emission
        this.broadcastLobbyJoinSequence(existingRoom, result.seat, user, result.matchStarted);

        return {
          success: true,
          roomId: existingRoom.roomId,
          roomCode: existingRoom.roomCode,
          name: existingRoom.name,
          gameMode: existingRoom.gameMode,
          kingdomType: existingRoom.kingdomType,
          seat: result.seat,
          matchStarted: result.matchStarted,
        };
      }
    }

    const room = this.gameRoomService.createRoom(user, client.id, {
      name: data?.name || `${user.displayName}'s Room`,
      password: data?.password,
      gameMode,
      kingdomType,
      turnTime: data?.turnTime || 20,
      allowSpectators: data?.allowSpectators ?? true,
      isPrivate: data?.isPrivate ?? false,
      allowBots,
    });

    this.trackSocketRoom(client, room.roomId);

    // Immediately broadcast room_updated to the host so the lobby initializes
    this.broadcastRoomUpdated(room.roomId);

    return {
      success: true,
      roomId: room.roomId,
      roomCode: room.roomCode,
      name: room.name,
      gameMode: room.gameMode,
      kingdomType: room.kingdomType,
      seat: 0,
      matchStarted: false,
    };
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomIdOrCode: string; password?: string },
  ) {
    try {
      if (!data?.roomIdOrCode) {
        return {
          success: false,
          message: 'Room not found or expired',
          code: 'ROOM_NOT_FOUND',
        };
      }

      const user = this.getUserFromSocket(client);

      // Leave any old room channel
      this.leaveAllRoomsForSocket(client, user.id, data.roomIdOrCode);

      const result = this.gameRoomService.joinRoom(
        user,
        client.id,
        data.roomIdOrCode,
        data.password,
      );

      this.trackSocketRoom(client, result.room.roomId);

      // BE-07 Strict sequential join sequence: player_joined -> room_updated -> match_started -> game_state
      this.broadcastLobbyJoinSequence(result.room, result.seat, user, result.matchStarted);

      return {
        success: true,
        roomId: result.room.roomId,
        seat: result.seat,
        matchStarted: result.matchStarted,
      };
    } catch (err: any) {
      const msg = err.message || '';
      let code = 'JOIN_ROOM_ERROR';
      let message = msg;

      if (err instanceof NotFoundException || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('expired')) {
        code = 'ROOM_NOT_FOUND';
        message = 'Room not found or expired';
      } else if (msg.toLowerCase().includes('full') || err instanceof ConflictException && msg.toLowerCase().includes('full')) {
        code = 'ROOM_FULL';
        message = 'Room is already full (4/4 players)';
      } else if (msg.toLowerCase().includes('progress') || msg.toLowerCase().includes('already started') || msg.toLowerCase().includes('active')) {
        code = 'MATCH_IN_PROGRESS';
        message = 'Match already in progress';
      } else if (msg.toLowerCase().includes('password') || err instanceof UnauthorizedException) {
        code = 'INVALID_PASSWORD';
        message = 'Invalid room password';
      }

      return {
        success: false,
        message,
        code,
      };
    }
  }

  @SubscribeMessage('quick_play')
  async handleQuickPlay(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { gameMode?: GameMode; kingdomType?: KingdomType; allowBots?: boolean },
  ) {
    try {
      const user = this.getUserFromSocket(client);
      const gameMode = data?.gameMode || 'SOLO';
      const kingdomType = data?.kingdomType || 'FREE_MERCY';
      const allowBots = data?.allowBots ?? true;

      // Leave any old room channel
      this.leaveAllRoomsForSocket(client, user.id);

      // 1. Check for an open, non-private waiting room matching gameMode, kingdomType, and allowBots
      const existingRoom = this.gameRoomService.findWaitingPublicRoom(gameMode, kingdomType, allowBots);
      if (existingRoom) {
        const result = this.gameRoomService.joinRoom(user, client.id, existingRoom.roomId);
        this.trackSocketRoom(client, existingRoom.roomId);

        // BE-07 Strict sequential join emission
        this.broadcastLobbyJoinSequence(existingRoom, result.seat, user, result.matchStarted);

        return {
          success: true,
          status: 'MATCHED',
          roomId: existingRoom.roomId,
          roomCode: existingRoom.roomCode,
          seat: result.seat,
          matchStarted: result.matchStarted,
        };
      }

      // 2. If no matching open room exists, spawn a default public room
      const room = this.gameRoomService.createRoom(user, client.id, {
        name: `${user.displayName}'s Room`,
        gameMode,
        kingdomType,
        turnTime: 20,
        isPrivate: false,
        allowBots,
      });

      this.trackSocketRoom(client, room.roomId);
      this.broadcastRoomUpdated(room.roomId);

      return {
        success: true,
        status: 'QUEUED',
        roomId: room.roomId,
        roomCode: room.roomCode,
        seat: 0,
        matchStarted: false,
      };
    } catch (err: any) {
      this.logger.error(`quick_play failed: ${err.message}`, err.stack);
      return {
        success: false,
        message: err.message || 'Quick play failed',
      };
    }
  }

  @SubscribeMessage('join_queue')
  async handleJoinQueue(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { gameMode?: GameMode; kingdomType?: KingdomType },
  ) {
    try {
      const user = this.getUserFromSocket(client);
      const gameMode = data?.gameMode || 'SOLO';
      const kingdomType = data?.kingdomType || 'FREE_MERCY';

      this.leaveAllRoomsForSocket(client, user.id);

      let queueLength = 1;
      if (this.matchmakingService) {
        await this.matchmakingService.enqueue(user, client.id, gameMode, kingdomType);
        const queueKey = this.matchmakingService.getQueueKey(gameMode, kingdomType);
        queueLength = await this.matchmakingService.getQueueLength(queueKey);
      } else {
        const existingRoom = this.gameRoomService.findWaitingPublicRoom(gameMode, kingdomType);
        if (existingRoom) {
          queueLength = existingRoom.players.filter((p) => p !== null).length + 1;
          const result = this.gameRoomService.joinRoom(user, client.id, existingRoom.roomId);
          this.trackSocketRoom(client, existingRoom.roomId);
          this.broadcastLobbyJoinSequence(existingRoom, result.seat, user, result.matchStarted);
        } else {
          const room = this.gameRoomService.createRoom(user, client.id, {
            name: `${user.displayName}'s Queue`,
            gameMode,
            kingdomType,
            turnTime: 20,
            isPrivate: false,
            allowBots: true,
          });
          this.trackSocketRoom(client, room.roomId);
          queueLength = 1;
        }
      }

      return { success: true, queueLength };
    } catch (err: any) {
      this.logger.error(`join_queue failed: ${err.message}`, err.stack);
      return { success: false, message: err.message || 'Failed to join queue' };
    }
  }

  @SubscribeMessage('leave_queue')
  async handleLeaveQueue(@ConnectedSocket() client: Socket) {
    try {
      const user = this.getUserFromSocket(client);

      if (this.matchmakingService) {
        await this.matchmakingService.dequeue(user.id);
      }

      const mapping = this.gameRoomService.findRoomBySocketId(client.id);
      if (mapping && mapping.room.status === 'WAITING') {
        if (this.botFillService) {
          this.botFillService.cancelBackfill(mapping.room.roomId);
        }
        this.gameRoomService.leaveRoom(user.id, mapping.room.roomId);
        client.leave(mapping.room.roomId);
        this.broadcastRoomUpdated(mapping.room.roomId);
      }

      this.leaveAllRoomsForSocket(client, user.id);

      return { success: true, message: 'Queue left successfully' };
    } catch (err: any) {
      this.logger.error(`leave_queue failed: ${err.message}`, err.stack);
      return { success: false, message: err.message || 'Failed to leave queue' };
    }
  }

  @SubscribeMessage('reconnect_game')
  handleReconnectGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { roomId?: string },
  ) {
    const user = this.getUserFromSocket(client);
    const room = data?.roomId
      ? this.gameRoomService.getRoom(data.roomId)
      : this.gameRoomService.findRoomByUserId(user.id);

    if (!room) {
      return { success: false, restored: false, message: 'No active match found for user' };
    }

    const result = this.gameRoomService.handleReconnect(user.id, client.id);
    if (!result) {
      return { success: false, restored: false, message: 'No active seat found in room' };
    }

    this.trackSocketRoom(client, room.roomId);

    // Broadcast room_updated to other players showing opponent is back online
    this.broadcastRoomUpdated(room.roomId);

    // Send full, authoritative, anti-cheat masked state snapshot directly to client socket
    if (room.engine) {
      const state = room.engine.getState();
      const seatsInfo: Record<number, PlayerSeatInfo> = {};
      for (let s = 0; s < 4; s++) {
        const p = room.players[s];
        seatsInfo[s] = {
          seat: s,
          userId: p?.userId,
          socketId: p?.socketId,
          displayName: p?.displayName || `Seat ${s + 1}`,
          avatarUrl: p?.avatarUrl,
          level: p?.level ?? 8,
          coins: p?.coins ?? 2500,
          stats: p?.stats ?? {
            gamesPlayed: 30,
            wins: 17,
            losses: 13,
            soloWins: 10,
            teamWins: 7,
            winRate: 56.7,
          },
          isConnected: p?.isConnected ?? false,
          isBot: false,
        };
      }

      const snapshot = PlayerViewSerializer.serialize(state, result.seat, room.roomId, {
        turnTimeLimit: room.turnTime,
        seatsInfo,
        turnId: room.turnId,
        stateVersion: room.stateVersion,
        turnDeadlineTimestamp: room.turnDeadlineTimestamp,
        roomSequence: room.roomSequence,
        serverTime: Date.now(),
        deadlineAt: room.turnDeadlineTimestamp,
      });

      this.server.to(client.id).emit('game_state', snapshot);
    }

    return {
      success: true,
      restored: true,
      roomId: room.roomId,
      seat: result.seat,
      stateVersion: room.stateVersion,
      turnId: room.turnId,
      roomSequence: room.roomSequence,
      deadlineAt: room.turnDeadlineTimestamp ?? null,
    };
  }

  @SubscribeMessage('select_contract')
  handleSelectContract(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; contracts?: ContractType[]; contract?: ContractType; actionId?: string },
  ) {
    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== data?.roomId) {
      return { success: false, code: 'UNAUTHORIZED_ROOM', message: 'Unauthorized room or seat' };
    }

    const contracts = data.contracts || (data.contract ? [data.contract] : []);
    return this.executeSelectContract(data.roomId, mapping.seat, contracts, data.actionId);
  }

  public executeSelectContract(
    roomId: string,
    seat: number,
    contracts: ContractType[],
    actionId?: string,
  ) {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    if (actionId) {
      if (!room.processedActionIds) room.processedActionIds = new Map();
      if (room.processedActionIds.has(actionId)) {
        return {
          success: true,
          duplicate: true,
          actionId,
          roomSequence: room.roomSequence,
          version: room.stateVersion,
          ...room.processedActionIds.get(actionId),
        };
      }
    }

    const ownerSeat = room.engine.getActiveKingdom().ownerSeat;
    if (seat !== ownerSeat) {
      return {
        success: false,
        message: `Only the active Kingdom Owner (Seat ${ownerSeat}) can choose contracts`,
      };
    }

    try {
      const callOff = this.gameRoomService.selectContract(room.roomId, seat, contracts);
      room.stateVersion++;
      room.turnId++;

      if (callOff.isCalledOff) {
        this.server.to(room.roomId).emit('call_off_triggered', {
          roomId: room.roomId,
          reason: callOff.reason,
          affectedSeat: callOff.affectedSeat,
          turnId: room.turnId,
          stateVersion: room.stateVersion,
          roomSequence: ++room.roomSequence,
        });
        this.broadcastMaskedState(room.roomId);
        return { success: true, isCalledOff: true, reason: callOff.reason };
      }

      const updatedState = room.engine.getState();

      if (actionId) {
        if (room.processedActionIds.size >= 50) {
          const oldest = room.processedActionIds.keys().next().value;
          if (oldest) room.processedActionIds.delete(oldest);
        }
        room.processedActionIds.set(actionId, { phase: updatedState.currentPhase });
      }

      if (updatedState.currentPhase === 'DOUBLING_PHASE') {
        const durationSeconds = 8;
        const deadlineTimestamp = Date.now() + durationSeconds * 1000;
        room.turnDeadlineTimestamp = deadlineTimestamp;

        this.server.to(room.roomId).emit('doubling_phase_started', {
          roomId: room.roomId,
          durationSeconds: 8,
          deadlineTimestamp,
          deadlineAt: deadlineTimestamp,
          activeContracts: updatedState.activeContracts,
          turnId: room.turnId,
          stateVersion: room.stateVersion,
          roomSequence: ++room.roomSequence,
        });

        // 8-second doubling countdown timer
        this.roomTimerService.startDoublingTimer(
          room.roomId,
          8,
          (tick) => {
            this.server.to(room.roomId).emit('timer_tick', {
              ...tick,
              turnId: room.turnId,
              stateVersion: room.stateVersion,
              roomSequence: ++room.roomSequence,
              serverTime: Date.now(),
              deadlineAt: tick.deadlineTimestamp,
            });
          },
          (doublingRoomId) => {
            // Doubling timeout -> start trick play
            if (room.engine && room.engine.getState().currentPhase === 'DOUBLING_PHASE') {
              room.engine.startTrickPlay();
              room.turnId++;
              room.stateVersion++;
              this.startRoomTurnTimer(room);
              this.broadcastMaskedState(room.roomId);
            }
          },
        );
      } else {
        // Trix play or Hands/Diamonds
        this.startRoomTurnTimer(room);
      }

      this.broadcastMaskedState(room.roomId);
      return {
        success: true,
        phase: updatedState.currentPhase,
        version: room.stateVersion,
        actionId,
        roomSequence: room.roomSequence,
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  @SubscribeMessage('declare_double')
  handleDeclareDouble(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; card: Card; actionId?: string },
  ) {
    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== data?.roomId) {
      return { success: false, code: 'UNAUTHORIZED_ROOM', message: 'Unauthorized room or seat' };
    }

    return this.executeDeclareDouble(data.roomId, mapping.seat, data.card, data.actionId);
  }

  public executeDeclareDouble(roomId: string, seat: number, card: Card, actionId?: string) {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    if (actionId) {
      if (!room.processedActionIds) room.processedActionIds = new Map();
      if (room.processedActionIds.has(actionId)) {
        return {
          success: true,
          duplicate: true,
          actionId,
          roomSequence: room.roomSequence,
          version: room.stateVersion,
          ...room.processedActionIds.get(actionId),
        };
      }
    }

    try {
      room.engine.doubleCard(seat, card);
      room.stateVersion++;

      if (actionId) {
        if (room.processedActionIds.size >= 50) {
          const oldest = room.processedActionIds.keys().next().value;
          if (oldest) room.processedActionIds.delete(oldest);
        }
        room.processedActionIds.set(actionId, { card });
      }

      this.server.to(room.roomId).emit('card_doubled', {
        roomId: room.roomId,
        seat,
        card,
        turnId: room.turnId,
        stateVersion: room.stateVersion,
        roomSequence: ++room.roomSequence,
      });

      this.broadcastMaskedState(room.roomId);
      return { success: true, version: room.stateVersion, actionId, roomSequence: room.roomSequence };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  @SubscribeMessage('play_card')
  handlePlayCard(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
      card: Card;
      actionId?: string;
      clientVersion?: number;
      turnId?: number;
    },
  ) {
    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== data?.roomId) {
      return { success: false, code: 'UNAUTHORIZED_ROOM', message: 'Unauthorized room or seat' };
    }

    return this.executePlayCard(data.roomId, mapping.seat, data.card, {
      actionId: data.actionId,
      clientVersion: data.clientVersion,
      turnId: data.turnId,
    });
  }

  public executePlayCard(
    roomId: string,
    seat: number,
    card: Card,
    options?: { actionId?: string; clientVersion?: number; turnId?: number; isAutoPlay?: boolean },
  ) {
    const actionStart = Date.now();
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    if (room.isProcessingAction) {
      return {
        success: false,
        code: 'ACTION_IN_PROGRESS',
        message: 'Action currently in progress for this room',
        turnId: room.turnId,
        version: room.stateVersion,
      };
    }

    room.isProcessingAction = true;
    try {
      // Idempotency check: LRU map and per-seat action history
      if (options?.actionId) {
        if (!room.processedActionIds) room.processedActionIds = new Map();
        if (room.processedActionIds.has(options.actionId)) {
          this.logger.log(
            `Duplicate actionId ${options.actionId} for seat ${seat} in room ${roomId}. Returning cached ack.`,
          );
          return {
            success: true,
            duplicate: true,
            actionId: options.actionId,
            roomSequence: room.roomSequence,
            version: room.stateVersion,
            turnId: room.turnId,
            ...room.processedActionIds.get(options.actionId),
          };
        }

        const seatActions = room.actionHistory.get(seat) || [];
        if (seatActions.includes(options.actionId)) {
          this.logger.log(
            `Duplicate actionId ${options.actionId} for seat ${seat} in room ${roomId}. Returning cached ack.`,
          );
          return {
            success: true,
            duplicate: true,
            actionId: options.actionId,
            roomSequence: room.roomSequence,
            version: room.stateVersion,
            turnId: room.turnId,
          };
        }
      }

      const state = room.engine.getState();

      // Sequence versioning check: reject stale turn actions
      if (options?.turnId !== undefined && options.turnId !== room.turnId) {
        return {
          success: false,
          code: 'NOT_YOUR_TURN',
          message: `Stale turn. Current turnId: ${room.turnId}, received: ${options.turnId}`,
          currentTurn: state.currentTurnSeat,
          turnId: room.turnId,
          version: room.stateVersion,
        };
      }

      // Turn check
      if (state.currentTurnSeat !== seat) {
        return {
          success: false,
          code: 'NOT_YOUR_TURN',
          message: `Not your turn. Current turn: Seat ${state.currentTurnSeat}`,
          currentTurn: state.currentTurnSeat,
          turnId: room.turnId,
          version: room.stateVersion,
        };
      }

      // Record actionId in seat's cache (keep last 10)
      if (options?.actionId) {
        const seatActions = room.actionHistory.get(seat) || [];
        seatActions.push(options.actionId);
        if (seatActions.length > 10) {
          seatActions.shift();
        }
        room.actionHistory.set(seat, seatActions);
      }

      this.logger.log(
        `[ACTION_RECEIVED] Room: ${roomId}, Turn: ${room.turnId}, Version: ${room.stateVersion}, Action: play_card, Seat: ${seat}`,
      );

      if (state.currentPhase === 'TRICK_PLAY') {
        // Synchronous validation using TrickEngine.validatePlay
        const hand = state.hands[seat];
        const validation = TrickEngine.validatePlay(
          hand,
          card,
          state.currentTrick,
          state.brokenSuits,
          state.activeContracts,
          state.kingdomType,
        );
        if (!validation.valid) {
          return {
            success: false,
            code: 'INVALID_PLAY',
            message: validation.reason || 'Illegal card play',
          };
        }

        const validateDuration = Date.now() - actionStart;
        this.logger.log(
          `[VALIDATED] Room: ${roomId}, Turn: ${room.turnId}, Version: ${room.stateVersion}, Duration: ${validateDuration}ms, Card: ${card.rank}${card.suit}`,
        );

        // Update authoritative state immediately
        const result = this.gameRoomService.playCard(room.roomId, seat, card) as {
          trickCompleted: boolean;
          trickWinner?: number;
          contractEnded?: boolean;
          scores?: Record<number, number>;
          winningCard?: Card;
          trickCards?: { seat: number; card: Card }[];
        };
        room.stateVersion++;

        if (options?.actionId) {
          if (room.processedActionIds.size >= 50) {
            const oldest = room.processedActionIds.keys().next().value;
            if (oldest) room.processedActionIds.delete(oldest);
          }
          room.processedActionIds.set(options.actionId, { card, seat });
        }

        if (options?.isAutoPlay) {
          this.server.to(room.roomId).emit('auto_played', {
            roomId: room.roomId,
            seat,
            card,
            phase: 'TRICK_PLAY',
            turnId: room.turnId,
            stateVersion: room.stateVersion,
            roomSequence: ++room.roomSequence,
          });
        }

        if (result.trickCompleted) {
          this.roomTimerService.stopTimer(room.roomId);
          const trickDuration = Date.now() - actionStart;
          this.logger.log(
            `[TRICK_EVALUATED] Room: ${roomId}, Turn: ${room.turnId}, Version: ${room.stateVersion}, WinnerSeat: ${result.trickWinner}, Duration: ${trickDuration}ms`,
          );

          // Emit trick_completed immediately to entire room
          this.server.to(room.roomId).emit('trick_completed', {
            roomId: room.roomId,
            trickCards: result.trickCards,
            trickWinnerSeat: result.trickWinner,
            winnerSeat: result.trickWinner,
            nextTurnSeat: result.trickWinner,
            roundScores: room.engine.getState().scores,
            displayDurationMs: 1500,
            turnId: room.turnId,
            stateVersion: room.stateVersion,
            roomSequence: ++room.roomSequence,
          });

          // Release action lock before broadcasting state so downstream handlers aren't blocked
          room.isProcessingAction = false;

          // Broadcast masked state with the 4 cards on the table
          this.broadcastMaskedState(room.roomId);

          // Server-authoritative delay of exactly 1500ms before starting Trick N+1
          setTimeout(() => {
            if (!room.engine) return;
            const advance = room.engine.clearTrickAndAdvance(result.trickWinner!);
            room.turnId++;
            room.stateVersion++;

            if (advance.contractEnded) {
              this.handleContractEnd(room, advance.scores);
            } else {
              this.startRoomTurnTimer(room);
            }
            this.broadcastMaskedState(room.roomId);
          }, 1500);

          return {
            success: true,
            card,
            actionId: options?.actionId,
            roomSequence: room.roomSequence,
            version: room.stateVersion,
            turnId: room.turnId,
            result,
          };
        } else {
          // Pass turn to next player in trick
          room.turnId++;
          this.startRoomTurnTimer(room);

          // Release action lock before broadcasting state
          room.isProcessingAction = false;

          this.broadcastMaskedState(room.roomId);
          return {
            success: true,
            card,
            actionId: options?.actionId,
            roomSequence: room.roomSequence,
            version: room.stateVersion,
            turnId: room.turnId,
            result,
          };
        }
      }

      if (state.currentPhase === 'TRIX_PLAY') {
        const hand = state.hands[seat];
        const validation = TrixContract.validatePlay(card, hand, state.trixColumns);
        if (!validation.valid) {
          return {
            success: false,
            code: 'INVALID_PLAY',
            message: validation.reason || 'Illegal Trix card play',
          };
        }

        const validateDuration = Date.now() - actionStart;
        this.logger.log(
          `[VALIDATED] Room: ${roomId}, Turn: ${room.turnId}, Version: ${room.stateVersion}, Duration: ${validateDuration}ms, Card: ${card.rank}${card.suit}`,
        );

        const result = this.gameRoomService.playCard(room.roomId, seat, card) as {
          finishedOrder: number[];
          isContractOver: boolean;
          scores?: Record<number, number>;
        };
        room.stateVersion++;

        if (options?.actionId) {
          if (room.processedActionIds.size >= 50) {
            const oldest = room.processedActionIds.keys().next().value;
            if (oldest) room.processedActionIds.delete(oldest);
          }
          room.processedActionIds.set(options.actionId, { card, seat });
        }

        if (options?.isAutoPlay) {
          this.server.to(room.roomId).emit('auto_played', {
            roomId: room.roomId,
            seat,
            card,
            phase: 'TRIX_PLAY',
            turnId: room.turnId,
            stateVersion: room.stateVersion,
            roomSequence: ++room.roomSequence,
          });
        }

        if (result.isContractOver) {
          this.handleContractEnd(room, result.scores);
        } else {
          room.turnId++;
          this.startRoomTurnTimer(room);
        }

        // Release action lock before broadcasting state
        room.isProcessingAction = false;

        this.broadcastMaskedState(room.roomId);
        return {
          success: true,
          card,
          actionId: options?.actionId,
          roomSequence: room.roomSequence,
          version: room.stateVersion,
          turnId: room.turnId,
          result,
        };
      }

      return {
        success: false,
        message: `Cannot play cards in phase: ${state.currentPhase}`,
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    } finally {
      room.isProcessingAction = false;
    }
  }

  @SubscribeMessage('pass_trix')
  handlePassTrix(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomId: string;
      actionId?: string;
      clientVersion?: number;
      turnId?: number;
    },
  ) {
    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== data?.roomId) {
      return { success: false, code: 'UNAUTHORIZED_ROOM', message: 'Unauthorized room or seat' };
    }

    return this.executePassTrix(data.roomId, mapping.seat, {
      actionId: data.actionId,
      clientVersion: data.clientVersion,
      turnId: data.turnId,
    });
  }

  public executePassTrix(
    roomId: string,
    seat: number,
    options?: { actionId?: string; clientVersion?: number; turnId?: number },
  ) {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    // Idempotency check: LRU map and per-seat action history
    if (options?.actionId) {
      if (!room.processedActionIds) room.processedActionIds = new Map();
      if (room.processedActionIds.has(options.actionId)) {
        return {
          success: true,
          duplicate: true,
          actionId: options.actionId,
          roomSequence: room.roomSequence,
          version: room.stateVersion,
          turnId: room.turnId,
          ...room.processedActionIds.get(options.actionId),
        };
      }

      const seatActions = room.actionHistory.get(seat) || [];
      if (seatActions.includes(options.actionId)) {
        return {
          success: true,
          duplicate: true,
          actionId: options.actionId,
          roomSequence: room.roomSequence,
          version: room.stateVersion,
          turnId: room.turnId,
        };
      }
      seatActions.push(options.actionId);
      if (seatActions.length > 10) seatActions.shift();
      room.actionHistory.set(seat, seatActions);
    }

    const state = room.engine.getState();

    // Sequence versioning check
    if (options?.turnId !== undefined && options.turnId !== room.turnId) {
      return {
        success: false,
        code: 'NOT_YOUR_TURN',
        message: `Stale move. Current turnId: ${room.turnId}, received: ${options.turnId}`,
        currentTurn: state.currentTurnSeat,
        turnId: room.turnId,
        version: room.stateVersion,
      };
    }

    if (state.currentTurnSeat !== seat) {
      return {
        success: false,
        code: 'NOT_YOUR_TURN',
        message: `Not your turn. Current turn: Seat ${state.currentTurnSeat}`,
        currentTurn: state.currentTurnSeat,
        turnId: room.turnId,
        version: room.stateVersion,
      };
    }

    try {
      this.gameRoomService.passTrix(room.roomId, seat);
      room.stateVersion++;
      room.turnId++;

      if (options?.actionId) {
        if (room.processedActionIds.size >= 50) {
          const oldestKey = room.processedActionIds.keys().next().value;
          if (oldestKey) room.processedActionIds.delete(oldestKey);
        }
        room.processedActionIds.set(options.actionId, { passed: true });
      }

      this.server.to(room.roomId).emit('auto_passed', {
        roomId: room.roomId,
        seat,
        turnId: room.turnId,
        stateVersion: room.stateVersion,
        roomSequence: ++room.roomSequence,
      });

      this.startRoomTurnTimer(room);
      this.broadcastMaskedState(room.roomId);

      return {
        success: true,
        turnId: room.turnId,
        version: room.stateVersion,
        actionId: options?.actionId,
        roomSequence: room.roomSequence,
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Starts countdown timer for the active turn seat or kingdom selection owner.
   */
  public startRoomTurnTimer(room: ActiveGameRoom): void {
    if (!room.engine) return;
    const state = room.engine.getState();

    if (state.currentPhase === 'KINGDOM_SELECTION') {
      const kingdom = room.engine.getActiveKingdom();
      const ownerSeat = kingdom.ownerSeat;
      const durationSeconds = 15;

      room.turnDeadlineTimestamp = this.roomTimerService.startKingdomSelectionTimer(
        room.roomId,
        ownerSeat,
        durationSeconds,
        (tick) => {
          this.server.to(room.roomId).emit('timer_tick', {
            ...tick,
            turnId: room.turnId,
            stateVersion: room.stateVersion,
            roomSequence: ++room.roomSequence,
            serverTime: Date.now(),
            deadlineAt: tick.deadlineTimestamp,
          });
        },
        (roomId, timeoutSeat) => {
          this.handleKingdomSelectionTimeout(room, timeoutSeat);
        },
      );
      return;
    }

    if (state.currentPhase !== 'TRICK_PLAY' && state.currentPhase !== 'TRIX_PLAY') {
      this.roomTimerService.stopTimer(room.roomId);
      room.turnDeadlineTimestamp = null;
      return;
    }

    const turnSeat = state.currentTurnSeat;

    room.turnDeadlineTimestamp = this.roomTimerService.startTurnTimer(
      room.roomId,
      turnSeat,
      room.turnTime,
      (tick) => {
        this.server.to(room.roomId).emit('timer_tick', {
          ...tick,
          turnId: room.turnId,
          stateVersion: room.stateVersion,
          roomSequence: ++room.roomSequence,
          serverTime: Date.now(),
          deadlineAt: tick.deadlineTimestamp,
        });
      },
      (roomId, timeoutSeat) => {
        this.handleTurnTimeout(room, timeoutSeat);
      },
      room.turnId,
    );
  }

  /**
   * Auto-selects contract on kingdom selection timeout to guarantee the room never deadlocks.
   */
  public handleKingdomSelectionTimeout(room: ActiveGameRoom, ownerSeat: number): void {
    if (!room.engine) return;
    const state = room.engine.getState();
    if (state.currentPhase !== 'KINGDOM_SELECTION') return;

    const kingdom = room.engine.getActiveKingdom();
    if (kingdom.ownerSeat !== ownerSeat) return;

    const available = ALL_CONTRACTS.filter(
      (c) => !kingdom.consumedContracts.includes(c),
    );
    if (available.length === 0) return;

    let chosenContracts: ContractType[] = [];
    if (room.kingdomType === 'CRAZY_COMPLEX') {
      const canChooseTrix = available.includes('TRIX');
      const canChooseNegatives = ['QUEENS', 'KING_OF_HEARTS', 'DIAMONDS', 'HANDS'].every((c: any) => available.includes(c));
      if (canChooseTrix) {
        chosenContracts = ['TRIX'];
      } else if (canChooseNegatives) {
        chosenContracts = ['QUEENS', 'KING_OF_HEARTS', 'DIAMONDS', 'HANDS'];
      } else {
        chosenContracts = [available[0]];
      }
    } else {
      chosenContracts = [available[0]];
    }

    this.logger.log(
      `Kingdom selection timed out for seat ${ownerSeat} in room ${room.roomId}. Auto-selecting [${chosenContracts.join(', ')}]`,
    );

    this.executeSelectContract(room.roomId, ownerSeat, chosenContracts);
  }

  /**
   * Auto-plays lowest legal card or passes on turn timeout.
   * Delegates directly to authoritative executePlayCard / executePassTrix pipeline.
   */
  public handleTurnTimeout(room: ActiveGameRoom, seat: number): void {
    if (!room.engine) return;
    const state = room.engine.getState();

    if (state.currentTurnSeat !== seat) return;

    try {
      if (state.currentPhase === 'TRIX_PLAY') {
        const card = this.gameRoomService.getFallbackCardToPlay(room, seat);
        if (card) {
          this.executePlayCard(room.roomId, seat, card, { isAutoPlay: true });
        } else {
          this.executePassTrix(room.roomId, seat);
        }
        return;
      }

      if (state.currentPhase === 'TRICK_PLAY') {
        const card = this.gameRoomService.getFallbackCardToPlay(room, seat);
        if (card) {
          this.executePlayCard(room.roomId, seat, card, { isAutoPlay: true });
        }
      }
    } catch (err: any) {
      this.logger.error(`Error handling turn timeout for seat ${seat}: ${err.message}`);
    }
  }

  private handleContractEnd(room: ActiveGameRoom, roundScores?: Record<number, number>): void {
    if (!room.engine) return;
    const state = room.engine.getState();

    this.server.to(room.roomId).emit('contract_ended', {
      roomId: room.roomId,
      roundScores,
      totalScores: state.scores,
      nextPhase: state.currentPhase,
      turnId: room.turnId,
      stateVersion: room.stateVersion,
      roomSequence: ++room.roomSequence,
    });

    if (state.currentPhase === 'GAME_OVER') {
      this.botActionService?.cancelPendingActions(room.roomId);

      this.server.to(room.roomId).emit('game_over', {
        roomId: room.roomId,
        finalScores: state.scores,
        turnId: room.turnId,
        stateVersion: room.stateVersion,
        roomSequence: ++room.roomSequence,
      });

      // Keep DB operations completely outside the hot path
      this.gameRoomService.saveMatchHistory(room).catch((err) => {
        this.logger.error(`Failed to asynchronously save match history: ${err.message}`);
      });
      this.roomTimerService.stopTimer(room.roomId);
    } else {
      this.startRoomTurnTimer(room);
    }
  }

  /**
   * Broadcasts individually masked, anti-cheat sanitized game state to all 4 seats.
   */
  public broadcastMaskedState(roomId: string): void {
    const broadcastStart = Date.now();
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || !room.engine) return;

    const state = room.engine.getState();

    const seatsInfo: Record<number, PlayerSeatInfo> = {};
    for (let s = 0; s < 4; s++) {
      const p = room.players[s];
      seatsInfo[s] = {
        seat: s,
        userId: p?.userId,
        socketId: p?.socketId,
        displayName: p?.displayName || `Seat ${s + 1}`,
        avatarUrl: p?.avatarUrl,
        level: p?.level ?? 8,
        coins: p?.coins ?? 2500,
        stats: p?.stats ?? {
          gamesPlayed: 30,
          wins: 17,
          losses: 13,
          soloWins: 10,
          teamWins: 7,
          winRate: 56.7,
        },
        isConnected: p?.isConnected ?? false,
        isBot: false, // Disguised! Anti-detection objective: Flutter client NEVER receives isBot: true
      };
    }

    for (let s = 0; s < 4; s++) {
      const player = room.players[s];
      if (player && player.isConnected && player.socketId) {
        const sanitized = PlayerViewSerializer.serialize(state, s, roomId, {
          turnTimeLimit: room.turnTime,
          seatsInfo,
          turnId: room.turnId,
          stateVersion: room.stateVersion,
          turnDeadlineTimestamp: room.turnDeadlineTimestamp,
          roomSequence: room.roomSequence,
          serverTime: Date.now(),
          deadlineAt: room.turnDeadlineTimestamp ?? null,
        });

        this.server.to(player.socketId).emit('game_state', sanitized);
      }
    }

    const broadcastDuration = Date.now() - broadcastStart;
    this.logger.log(
      `[STATE_BROADCAST] Room: ${roomId}, Turn: ${room.turnId}, Version: ${room.stateVersion}, Duration: ${broadcastDuration}ms`,
    );

    // Trigger AI automation for any active bot seat
    if (state.currentPhase === 'KINGDOM_SELECTION') {
      const ownerSeat = room.engine.getActiveKingdom().ownerSeat;
      if (room.players[ownerSeat]?.isBot) {
        this.botActionService?.handleBotTurn(room.roomId, ownerSeat);
      }
    } else if (state.currentPhase === 'TRICK_PLAY' || state.currentPhase === 'TRIX_PLAY') {
      const turnSeat = state.currentTurnSeat;
      if (room.players[turnSeat]?.isBot) {
        this.botActionService?.handleBotTurn(room.roomId, turnSeat);
      }
    } else {
      this.botActionService?.evaluateAndTrigger(room);
    }
  }
}
