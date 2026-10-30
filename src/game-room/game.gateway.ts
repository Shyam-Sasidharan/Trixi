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

  constructor(
    private readonly gameRoomService: GameRoomService,
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
  }

  afterInit(server: Server) {
    if (this.botActionService) this.botActionService.setGateway(this);
    if (this.botFillService) this.botFillService.setGateway(this);
    if (this.matchmakingService) this.matchmakingService.setGateway(this);
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
  }

  public broadcastRoomUpdated(roomId: string): void {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room) return;

    this.server.to(roomId).emit('room_updated', {
      roomId,
      players: room.players
        .filter((p): p is ActivePlayer => p !== null)
        .map((p) => ({
          seat: p.seat,
          seatIndex: p.seat,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          isHost: p.seat === 0,
          isReady: true,
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

    // Leave any old room channel
    const prevMapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (prevMapping) {
      client.leave(prevMapping.room.roomId);
      this.gameRoomService.leaveRoom(user.id, prevMapping.room.roomId);
    }

    // If public room without password, check if there is an existing waiting public room
    if (!data?.isPrivate && !data?.password) {
      const existingRoom = this.gameRoomService.findWaitingPublicRoom(gameMode, kingdomType);
      if (existingRoom) {
        const result = this.gameRoomService.joinRoom(user, client.id, existingRoom.roomId);
        client.join(existingRoom.roomId);

        this.broadcastRoomUpdated(existingRoom.roomId);

        if (result.matchStarted) {
          this.server.to(existingRoom.roomId).emit('match_started', {
            roomId: existingRoom.roomId,
            gameMode: existingRoom.gameMode,
            kingdomType: existingRoom.kingdomType,
            firstTurnSeat: existingRoom.engine ? existingRoom.engine.getState().currentTurnSeat : 0,
            kingdomIndex: 1,
            kingdomOwnerSeat: existingRoom.engine ? existingRoom.engine.getActiveKingdom().ownerSeat : 0,
          });
          this.startRoomTurnTimer(existingRoom);
          this.broadcastMaskedState(existingRoom.roomId);
        } else {
          this.server.to(existingRoom.roomId).emit('player_joined', {
            roomId: existingRoom.roomId,
            seat: result.seat,
            user: {
              id: user.id,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
              level: (user as any).level ?? 8,
              coins: (user as any).coins ?? 2500,
              stats: (user as any).stats ?? {
                gamesPlayed: 30,
                wins: 17,
                losses: 13,
                soloWins: 10,
                teamWins: 7,
                winRate: 56.7,
              },
            },
          });
        }

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
      allowBots: data?.allowBots ?? (!data?.isPrivate),
    });

    client.join(room.roomId);

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
    const user = this.getUserFromSocket(client);

    // Leave any old room channel
    const prevMapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (prevMapping && prevMapping.room.roomId !== data.roomIdOrCode && prevMapping.room.roomCode !== data.roomIdOrCode?.toUpperCase()) {
      client.leave(prevMapping.room.roomId);
      this.gameRoomService.leaveRoom(user.id, prevMapping.room.roomId);
    }

    const result = this.gameRoomService.joinRoom(
      user,
      client.id,
      data.roomIdOrCode,
      data.password,
    );

    client.join(result.room.roomId);

    // Broadcast room_updated immediately
    this.broadcastRoomUpdated(result.room.roomId);

    if (result.matchStarted) {
      // 4th player joined! Match starts automatically
      this.server.to(result.room.roomId).emit('match_started', {
        roomId: result.room.roomId,
        gameMode: result.room.gameMode,
        kingdomType: result.room.kingdomType,
        firstTurnSeat: result.room.engine ? result.room.engine.getState().currentTurnSeat : 0,
        kingdomIndex: 1,
        kingdomOwnerSeat: result.room.engine ? result.room.engine.getActiveKingdom().ownerSeat : 0,
      });

      // Start turn timer for Kingdom Owner
      this.startRoomTurnTimer(result.room);
      this.broadcastMaskedState(result.room.roomId);
    } else {
      // Inform lobby of new player
      this.server.to(result.room.roomId).emit('player_joined', {
        roomId: result.room.roomId,
        seat: result.seat,
        user: {
          id: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          level: (user as any).level ?? 8,
          coins: (user as any).coins ?? 2500,
          stats: (user as any).stats ?? {
            gamesPlayed: 30,
            wins: 17,
            losses: 13,
            soloWins: 10,
            teamWins: 7,
            winRate: 56.7,
          },
        },
      });
    }

    return {
      success: true,
      roomId: result.room.roomId,
      seat: result.seat,
      matchStarted: result.matchStarted,
    };
  }

  @SubscribeMessage('quick_play')
  async handleQuickPlay(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { gameMode?: GameMode; kingdomType?: KingdomType },
  ) {
    const user = this.getUserFromSocket(client);
    const gameMode = data?.gameMode || 'SOLO';
    const kingdomType = data?.kingdomType || 'FREE_MERCY';

    // Leave any old room channel
    const prevMapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (prevMapping) {
      client.leave(prevMapping.room.roomId);
      this.gameRoomService.leaveRoom(user.id, prevMapping.room.roomId);
    }

    // 1. Check for an open, non-private waiting room matching gameMode & kingdomType
    const existingRoom = this.gameRoomService.findWaitingPublicRoom(gameMode, kingdomType);
    if (existingRoom) {
      const result = this.gameRoomService.joinRoom(user, client.id, existingRoom.roomId);
      client.join(existingRoom.roomId);

      this.broadcastRoomUpdated(existingRoom.roomId);

      if (result.matchStarted) {
        this.server.to(existingRoom.roomId).emit('match_started', {
          roomId: existingRoom.roomId,
          gameMode: existingRoom.gameMode,
          kingdomType: existingRoom.kingdomType,
          firstTurnSeat: existingRoom.engine ? existingRoom.engine.getState().currentTurnSeat : 0,
          kingdomIndex: 1,
          kingdomOwnerSeat: existingRoom.engine ? existingRoom.engine.getActiveKingdom().ownerSeat : 0,
        });
        this.startRoomTurnTimer(existingRoom);
        this.broadcastMaskedState(existingRoom.roomId);
      } else {
        this.server.to(existingRoom.roomId).emit('player_joined', {
          roomId: existingRoom.roomId,
          seat: result.seat,
          user: {
            id: user.id,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            level: (user as any).level ?? 8,
            coins: (user as any).coins ?? 2500,
            stats: (user as any).stats ?? {
              gamesPlayed: 30,
              wins: 17,
              losses: 13,
              soloWins: 10,
              teamWins: 7,
              winRate: 56.7,
            },
          },
        });
      }

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
      allowBots: true,
    });

    client.join(room.roomId);
    this.broadcastRoomUpdated(room.roomId);

    return {
      success: true,
      status: 'QUEUED',
      roomId: room.roomId,
      roomCode: room.roomCode,
      seat: 0,
      matchStarted: false,
    };
  }

  @SubscribeMessage('join_queue')
  async handleJoinQueue(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { gameMode?: GameMode; kingdomType?: KingdomType },
  ) {
    return this.handleQuickPlay(client, data);
  }

  @SubscribeMessage('leave_queue')
  async handleLeaveQueue(@ConnectedSocket() client: Socket) {
    const user = this.getUserFromSocket(client);
    if (this.matchmakingService) {
      const dequeued = await this.matchmakingService.dequeue(user.id);
      return { success: true, dequeued };
    }
    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (mapping && mapping.room.status === 'WAITING') {
      this.gameRoomService.leaveRoom(user.id, mapping.room.roomId);
      client.leave(mapping.room.roomId);
      this.broadcastRoomUpdated(mapping.room.roomId);
      return { success: true, dequeued: true };
    }
    return { success: true, dequeued: false };
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

    client.join(room.roomId);

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
    };
  }

  @SubscribeMessage('select_contract')
  handleSelectContract(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; contracts?: ContractType[]; contract?: ContractType },
  ) {
    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== data?.roomId) {
      return { success: false, code: 'UNAUTHORIZED_ROOM', message: 'Unauthorized room or seat' };
    }

    const contracts = data.contracts || (data.contract ? [data.contract] : []);
    return this.executeSelectContract(data.roomId, mapping.seat, contracts);
  }

  public executeSelectContract(
    roomId: string,
    seat: number,
    contracts: ContractType[],
  ) {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    const ownerSeat = room.engine.getActiveKingdom().ownerSeat;
    if (seat !== ownerSeat) {
      return {
        success: false,
        message: `Only the active Kingdom Owner (Seat ${ownerSeat}) can choose contracts`,
      };
    }

    try {
      const callOff = room.engine.selectContracts(contracts);
      room.stateVersion++;
      room.turnId++;

      if (callOff.isCalledOff) {
        this.server.to(room.roomId).emit('call_off_triggered', {
          roomId: room.roomId,
          reason: callOff.reason,
          affectedSeat: callOff.affectedSeat,
          turnId: room.turnId,
          stateVersion: room.stateVersion,
        });
        this.broadcastMaskedState(room.roomId);
        return { success: true, isCalledOff: true, reason: callOff.reason };
      }

      const updatedState = room.engine.getState();

      if (updatedState.currentPhase === 'DOUBLING_PHASE') {
        const durationSeconds = 8;
        const deadlineTimestamp = Date.now() + durationSeconds * 1000;
        room.turnDeadlineTimestamp = deadlineTimestamp;

        this.server.to(room.roomId).emit('doubling_phase_started', {
          roomId: room.roomId,
          durationSeconds: 8,
          deadlineTimestamp,
          activeContracts: updatedState.activeContracts,
          turnId: room.turnId,
          stateVersion: room.stateVersion,
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
      return { success: true, phase: updatedState.currentPhase, version: room.stateVersion };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  @SubscribeMessage('declare_double')
  handleDeclareDouble(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; card: Card },
  ) {
    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== data?.roomId) {
      return { success: false, code: 'UNAUTHORIZED_ROOM', message: 'Unauthorized room or seat' };
    }

    return this.executeDeclareDouble(data.roomId, mapping.seat, data.card);
  }

  public executeDeclareDouble(roomId: string, seat: number, card: Card) {
    const room = this.gameRoomService.getRoom(roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    try {
      room.engine.doubleCard(seat, card);
      room.stateVersion++;

      this.server.to(room.roomId).emit('card_doubled', {
        roomId: room.roomId,
        seat,
        card,
        turnId: room.turnId,
        stateVersion: room.stateVersion,
      });

      this.broadcastMaskedState(room.roomId);
      return { success: true, version: room.stateVersion };
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
    options?: { actionId?: string; clientVersion?: number; turnId?: number },
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
      // Idempotency check: Cache last 10 processed actionIds per seat
      if (options?.actionId) {
        const seatActions = room.actionHistory.get(seat) || [];
        if (seatActions.includes(options.actionId)) {
          this.logger.log(
            `Duplicate actionId ${options.actionId} for seat ${seat} in room ${roomId}. Returning cached ack.`,
          );
          return {
            success: true,
            duplicate: true,
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
        const result = room.engine.playTrickCard(seat, card);
        room.stateVersion++;

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
          });

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
            version: room.stateVersion,
            turnId: room.turnId,
            result,
          };
        } else {
          // Pass turn to next player in trick
          room.turnId++;
          this.startRoomTurnTimer(room);
          this.broadcastMaskedState(room.roomId);
          return {
            success: true,
            card,
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

        const result = room.engine.playTrixCard(seat, card);
        room.stateVersion++;

        if (result.isContractOver) {
          this.handleContractEnd(room, result.scores);
        } else {
          room.turnId++;
          this.startRoomTurnTimer(room);
        }

        this.broadcastMaskedState(room.roomId);
        return {
          success: true,
          card,
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

    // Idempotency check
    if (options?.actionId) {
      const seatActions = room.actionHistory.get(seat) || [];
      if (seatActions.includes(options.actionId)) {
        return {
          success: true,
          duplicate: true,
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
      room.engine.passTrixTurn(seat);
      room.stateVersion++;
      room.turnId++;

      this.server.to(room.roomId).emit('auto_passed', {
        roomId: room.roomId,
        seat,
        turnId: room.turnId,
        stateVersion: room.stateVersion,
      });

      this.startRoomTurnTimer(room);
      this.broadcastMaskedState(room.roomId);

      return {
        success: true,
        turnId: room.turnId,
        version: room.stateVersion,
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Starts countdown timer for the active turn seat.
   */
  public startRoomTurnTimer(room: ActiveGameRoom): void {
    if (!room.engine) return;
    const state = room.engine.getState();

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
        });
      },
      (roomId, timeoutSeat) => {
        this.handleTurnTimeout(room, timeoutSeat);
      },
      room.turnId,
    );
  }

  /**
   * Auto-plays lowest legal card or passes on turn timeout.
   */
  public handleTurnTimeout(room: ActiveGameRoom, seat: number): void {
    if (!room.engine) return;
    const state = room.engine.getState();

    if (state.currentTurnSeat !== seat) return;

    try {
      if (state.currentPhase === 'TRIX_PLAY') {
        const card = this.gameRoomService.getFallbackCardToPlay(room, seat);
        if (card) {
          const res = room.engine.playTrixCard(seat, card);
          room.stateVersion++;

          this.server.to(room.roomId).emit('auto_played', {
            roomId: room.roomId,
            seat,
            card,
            phase: 'TRIX_PLAY',
            turnId: room.turnId,
            stateVersion: room.stateVersion,
          });

          if (res.isContractOver) {
            this.handleContractEnd(room, res.scores);
          } else {
            room.turnId++;
            this.startRoomTurnTimer(room);
          }
        } else {
          room.engine.passTrixTurn(seat);
          room.stateVersion++;
          room.turnId++;

          this.server.to(room.roomId).emit('auto_passed', {
            roomId: room.roomId,
            seat,
            turnId: room.turnId,
            stateVersion: room.stateVersion,
          });
          this.startRoomTurnTimer(room);
        }
        this.broadcastMaskedState(room.roomId);
        return;
      }

      if (state.currentPhase === 'TRICK_PLAY') {
        const card = this.gameRoomService.getFallbackCardToPlay(room, seat);
        if (card) {
          const res = room.engine.playTrickCard(seat, card);
          room.stateVersion++;

          this.server.to(room.roomId).emit('auto_played', {
            roomId: room.roomId,
            seat,
            card,
            phase: 'TRICK_PLAY',
            turnId: room.turnId,
            stateVersion: room.stateVersion,
          });

          if (res.trickCompleted) {
            this.roomTimerService.stopTimer(room.roomId);

            this.server.to(room.roomId).emit('trick_completed', {
              roomId: room.roomId,
              trickCards: res.trickCards,
              trickWinnerSeat: res.trickWinner,
              winnerSeat: res.trickWinner,
              nextTurnSeat: res.trickWinner,
              roundScores: room.engine.getState().scores,
              displayDurationMs: 1500,
              turnId: room.turnId,
              stateVersion: room.stateVersion,
            });

            this.broadcastMaskedState(room.roomId);

            setTimeout(() => {
              if (!room.engine) return;
              const advance = room.engine.clearTrickAndAdvance(res.trickWinner!);
              room.turnId++;
              room.stateVersion++;

              if (advance.contractEnded) {
                this.handleContractEnd(room, advance.scores);
              } else {
                this.startRoomTurnTimer(room);
              }
              this.broadcastMaskedState(room.roomId);
            }, 1500);
          } else {
            room.turnId++;
            this.startRoomTurnTimer(room);
            this.broadcastMaskedState(room.roomId);
          }
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
    });

    if (state.currentPhase === 'GAME_OVER') {
      this.server.to(room.roomId).emit('game_over', {
        roomId: room.roomId,
        finalScores: state.scores,
        turnId: room.turnId,
        stateVersion: room.stateVersion,
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
        });

        this.server.to(player.socketId).emit('game_state', sanitized);
      }
    }

    const broadcastDuration = Date.now() - broadcastStart;
    this.logger.log(
      `[STATE_BROADCAST] Room: ${roomId}, Turn: ${room.turnId}, Version: ${room.stateVersion}, Duration: ${broadcastDuration}ms`,
    );

    // Trigger AI automation for any active bot seat
    this.botActionService?.evaluateAndTrigger(room);
  }
}
