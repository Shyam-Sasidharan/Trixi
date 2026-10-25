import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GameRoomService, ActiveGameRoom } from './services/game-room.service.js';
import { RoomTimerService, TimerTickEvent } from './services/room-timer.service.js';
import { PlayerViewSerializer, PlayerSeatInfo } from './serializers/player-view.serializer.js';
import { ContractType, GameMode, KingdomType } from '../game-engine/types/contract.types.js';
import { Card } from '../game-engine/types/card.types.js';

interface SocketUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly gameRoomService: GameRoomService,
    private readonly roomTimerService: RoomTimerService,
    private readonly jwtService: JwtService,
  ) {}

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
    const disconnected = this.gameRoomService.handleDisconnect(client.id, (roomId, seat) => {
      // Called when 30s grace timer expires and seat becomes bot
      this.broadcastMaskedState(roomId);
    });

    if (disconnected) {
      this.broadcastMaskedState(disconnected.roomId);
    }
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
    },
  ) {
    const user = this.getUserFromSocket(client);
    const room = this.gameRoomService.createRoom(user, client.id, {
      name: data?.name || `${user.displayName}'s Room`,
      password: data?.password,
      gameMode: data?.gameMode || 'SOLO',
      kingdomType: data?.kingdomType || 'FREE_MERCY',
      turnTime: data?.turnTime || 20,
      allowSpectators: data?.allowSpectators ?? true,
      isPrivate: data?.isPrivate ?? false,
    });

    client.join(room.roomId);

    return {
      success: true,
      roomId: room.roomId,
      roomCode: room.roomCode,
      name: room.name,
      gameMode: room.gameMode,
      kingdomType: room.kingdomType,
      seat: 0,
    };
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomIdOrCode: string; password?: string },
  ) {
    const user = this.getUserFromSocket(client);
    const result = this.gameRoomService.joinRoom(
      user,
      client.id,
      data.roomIdOrCode,
      data.password,
    );

    client.join(result.room.roomId);

    if (result.matchStarted) {
      // 4th player joined! Match starts automatically
      this.server.to(result.room.roomId).emit('match_started', {
        roomId: result.room.roomId,
        gameMode: result.room.gameMode,
        kingdomType: result.room.kingdomType,
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

  @SubscribeMessage('reconnect_game')
  handleReconnectGame(@ConnectedSocket() client: Socket) {
    const user = this.getUserFromSocket(client);
    const result = this.gameRoomService.handleReconnect(user.id, client.id);

    if (!result) {
      return { success: false, message: 'No active match found for user' };
    }

    client.join(result.room.roomId);
    this.broadcastMaskedState(result.room.roomId);

    return {
      success: true,
      roomId: result.room.roomId,
      seat: result.seat,
    };
  }

  @SubscribeMessage('select_contract')
  handleSelectContract(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; contracts: ContractType[] },
  ) {
    const room = this.gameRoomService.getRoom(data.roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== room.roomId) {
      return { success: false, message: 'Unauthorized seat' };
    }

    const state = room.engine.getState();
    const ownerSeat = room.engine.getActiveKingdom().ownerSeat;
    if (mapping.seat !== ownerSeat) {
      return { success: false, message: `Only the active Kingdom Owner (Seat ${ownerSeat}) can choose contracts` };
    }

    try {
      const callOff = room.engine.selectContracts(data.contracts);

      if (callOff.isCalledOff) {
        this.server.to(room.roomId).emit('call_off_triggered', {
          roomId: room.roomId,
          reason: callOff.reason,
          affectedSeat: callOff.affectedSeat,
        });
        this.broadcastMaskedState(room.roomId);
        return { success: true, isCalledOff: true, reason: callOff.reason };
      }

      const updatedState = room.engine.getState();

      if (updatedState.currentPhase === 'DOUBLING_PHASE') {
        this.server.to(room.roomId).emit('doubling_phase_started', {
          roomId: room.roomId,
          durationSeconds: 8,
          activeContracts: updatedState.activeContracts,
        });

        // 8-second doubling countdown timer
        this.roomTimerService.startDoublingTimer(
          room.roomId,
          8,
          (tick) => {
            this.server.to(room.roomId).emit('timer_tick', tick);
          },
          (roomId) => {
            // Doubling timeout -> start trick play
            if (room.engine && room.engine.getState().currentPhase === 'DOUBLING_PHASE') {
              room.engine.startTrickPlay();
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
      return { success: true, phase: updatedState.currentPhase };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  @SubscribeMessage('declare_double')
  handleDeclareDouble(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; card: Card },
  ) {
    const room = this.gameRoomService.getRoom(data.roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== room.roomId) {
      return { success: false, message: 'Unauthorized seat' };
    }

    try {
      room.engine.doubleCard(mapping.seat, data.card);

      this.server.to(room.roomId).emit('card_doubled', {
        roomId: room.roomId,
        seat: mapping.seat,
        card: data.card,
      });

      this.broadcastMaskedState(room.roomId);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  @SubscribeMessage('play_card')
  handlePlayCard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; card: Card },
  ) {
    const room = this.gameRoomService.getRoom(data.roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== room.roomId) {
      return { success: false, message: 'Unauthorized seat' };
    }

    const state = room.engine.getState();
    if (state.currentTurnSeat !== mapping.seat) {
      return { success: false, message: `Not your turn. Current turn: Seat ${state.currentTurnSeat}` };
    }

    try {
      if (state.currentPhase === 'TRICK_PLAY') {
        const result = room.engine.playTrickCard(mapping.seat, data.card);

        if (result.trickCompleted) {
          this.roomTimerService.stopTimer(room.roomId);

          this.server.to(room.roomId).emit('trick_completed', {
            roomId: room.roomId,
            winnerSeat: result.trickWinner,
            completedTrick: room.engine.getState().trickHistory.slice(-1)[0],
          });

          if (result.contractEnded) {
            this.handleContractEnd(room, result.scores);
          } else {
            // Next trick led by winner
            this.startRoomTurnTimer(room);
          }
        } else {
          // Pass turn to next player in trick
          this.startRoomTurnTimer(room);
        }

        this.broadcastMaskedState(room.roomId);
        return { success: true, result };
      }

      if (state.currentPhase === 'TRIX_PLAY') {
        const result = room.engine.playTrixCard(mapping.seat, data.card);

        if (result.isContractOver) {
          this.handleContractEnd(room, result.scores);
        } else {
          this.startRoomTurnTimer(room);
        }

        this.broadcastMaskedState(room.roomId);
        return { success: true, result };
      }

      return { success: false, message: `Cannot play cards in phase: ${state.currentPhase}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  @SubscribeMessage('pass_trix')
  handlePassTrix(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const room = this.gameRoomService.getRoom(data.roomId);
    if (!room || !room.engine) {
      return { success: false, message: 'Active game not found' };
    }

    const mapping = this.gameRoomService.findRoomBySocketId(client.id);
    if (!mapping || mapping.room.roomId !== room.roomId) {
      return { success: false, message: 'Unauthorized seat' };
    }

    try {
      room.engine.passTrixTurn(mapping.seat);

      this.server.to(room.roomId).emit('player_passed', {
        roomId: room.roomId,
        seat: mapping.seat,
      });

      this.startRoomTurnTimer(room);
      this.broadcastMaskedState(room.roomId);

      return { success: true };
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
      return;
    }

    const turnSeat = state.currentTurnSeat;

    this.roomTimerService.startTurnTimer(
      room.roomId,
      turnSeat,
      room.turnTime,
      (tick) => {
        this.server.to(room.roomId).emit('timer_tick', tick);
      },
      (roomId, timeoutSeat) => {
        this.handleTurnTimeout(room, timeoutSeat);
      },
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
          this.server.to(room.roomId).emit('auto_played', {
            roomId: room.roomId,
            seat,
            card,
            phase: 'TRIX_PLAY',
          });

          if (res.isContractOver) {
            this.handleContractEnd(room, res.scores);
          } else {
            this.startRoomTurnTimer(room);
          }
        } else {
          room.engine.passTrixTurn(seat);
          this.server.to(room.roomId).emit('auto_passed', {
            roomId: room.roomId,
            seat,
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
          this.server.to(room.roomId).emit('auto_played', {
            roomId: room.roomId,
            seat,
            card,
            phase: 'TRICK_PLAY',
          });

          if (res.trickCompleted) {
            this.server.to(room.roomId).emit('trick_completed', {
              roomId: room.roomId,
              winnerSeat: res.trickWinner,
            });

            if (res.contractEnded) {
              this.handleContractEnd(room, res.scores);
            } else {
              this.startRoomTurnTimer(room);
            }
          } else {
            this.startRoomTurnTimer(room);
          }
          this.broadcastMaskedState(room.roomId);
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
    });

    if (state.currentPhase === 'GAME_OVER') {
      this.server.to(room.roomId).emit('game_over', {
        roomId: room.roomId,
        finalScores: state.scores,
      });

      this.gameRoomService.saveMatchHistory(room);
      this.roomTimerService.stopTimer(room.roomId);
    } else {
      this.startRoomTurnTimer(room);
    }
  }

  /**
   * Broadcasts individually masked, anti-cheat sanitized game state to all 4 seats.
   */
  public broadcastMaskedState(roomId: string): void {
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
        isConnected: p?.isConnected ?? false,
        isBot: p?.isBot ?? false,
      };
    }

    for (let s = 0; s < 4; s++) {
      const player = room.players[s];
      if (player && player.isConnected && player.socketId) {
        const sanitized = PlayerViewSerializer.serialize(state, s, roomId, {
          turnTimeLimit: room.turnTime,
          seatsInfo,
        });

        this.server.to(player.socketId).emit('game_state', sanitized);
      }
    }
  }
}
