import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GameGateway } from '../game.gateway.js';
import { GameRoomService } from '../services/game-room.service.js';
import { RoomTimerService } from '../services/room-timer.service.js';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';

describe('GameGateway (WebSocket Gateway Integration)', () => {
  let gateway: GameGateway;
  let roomService: GameRoomService;
  let timerService: RoomTimerService;
  let mockServer: any;

  beforeEach(() => {
    const mockPrisma = {
      matchHistory: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };

    roomService = new GameRoomService(mockPrisma as PrismaService);
    timerService = new RoomTimerService();
    const jwtService = new JwtService({ secret: 'test-secret' });

    gateway = new GameGateway(roomService, timerService, jwtService);

    mockServer = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };
    gateway.server = mockServer as any;
  });

  afterEach(() => {
    timerService.stopAllTimers();
  });

  function createMockSocket(id: string, userId: string, displayName: string): any {
    return {
      id,
      data: {
        user: { id: userId, email: `${userId}@trix.com`, displayName },
      },
      join: vi.fn(),
      emit: vi.fn(),
      handshake: { auth: {}, headers: {}, query: {} },
    };
  }

  it('should handle create_room and join socket to room channel', () => {
    const socket = createMockSocket('sock-1', 'user-1', 'TrixLord');

    const result = gateway.handleCreateRoom(socket, {
      name: 'Championship Room',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
      turnTime: 20,
    });

    expect(result.success).toBe(true);
    expect(result.roomId).toBeDefined();
    expect(result.roomCode.length).toBe(6);
    expect(result.seat).toBe(0);
    expect(socket.join).toHaveBeenCalledWith(result.roomId);
  });

  it('should handle join_room and trigger match when 4th player connects', () => {
    const s1 = createMockSocket('s1', 'u1', 'Player 1');
    const s2 = createMockSocket('s2', 'u2', 'Player 2');
    const s3 = createMockSocket('s3', 'u3', 'Player 3');
    const s4 = createMockSocket('s4', 'u4', 'Player 4');

    const createRes = gateway.handleCreateRoom(s1, {});
    const roomId = createRes.roomId;

    const join2 = gateway.handleJoinRoom(s2, { roomIdOrCode: roomId });
    expect(join2.seat).toBe(1);
    expect(join2.matchStarted).toBe(false);

    const join3 = gateway.handleJoinRoom(s3, { roomIdOrCode: roomId });
    expect(join3.seat).toBe(2);
    expect(join3.matchStarted).toBe(false);

    const join4 = gateway.handleJoinRoom(s4, { roomIdOrCode: roomId });
    expect(join4.seat).toBe(3);
    expect(join4.matchStarted).toBe(true);

    // Verify broadcast match_started was called
    expect(mockServer.to).toHaveBeenCalledWith(roomId);
    expect(mockServer.emit).toHaveBeenCalledWith('match_started', expect.any(Object));
  });

  it('should handle select_contract and broadcast doubling_phase_started for Queens', () => {
    const s1 = createMockSocket('s1', 'u1', 'P1');
    const s2 = createMockSocket('s2', 'u2', 'P2');
    const s3 = createMockSocket('s3', 'u3', 'P3');
    const s4 = createMockSocket('s4', 'u4', 'P4');

    const roomRes = gateway.handleCreateRoom(s1, {});
    gateway.handleJoinRoom(s2, { roomIdOrCode: roomRes.roomId });
    gateway.handleJoinRoom(s3, { roomIdOrCode: roomRes.roomId });
    gateway.handleJoinRoom(s4, { roomIdOrCode: roomRes.roomId });

    const room = roomService.getRoom(roomRes.roomId)!;
    const ownerSeat = room.engine!.getActiveKingdom().ownerSeat;
    const ownerSocket = [s1, s2, s3, s4][ownerSeat];

    const selectRes = gateway.handleSelectContract(ownerSocket, {
      roomId: room.roomId,
      contracts: ['QUEENS'],
    });

    expect(selectRes.success).toBe(true);
    expect(selectRes.phase).toBe('DOUBLING_PHASE');
    expect(mockServer.emit).toHaveBeenCalledWith('doubling_phase_started', expect.any(Object));
  });

  it('should handle play_card during trick play and advance turn', () => {
    const s1 = createMockSocket('s1', 'u1', 'P1');
    const s2 = createMockSocket('s2', 'u2', 'P2');
    const s3 = createMockSocket('s3', 'u3', 'P3');
    const s4 = createMockSocket('s4', 'u4', 'P4');

    const roomRes = gateway.handleCreateRoom(s1, {});
    gateway.handleJoinRoom(s2, { roomIdOrCode: roomRes.roomId });
    gateway.handleJoinRoom(s3, { roomIdOrCode: roomRes.roomId });
    gateway.handleJoinRoom(s4, { roomIdOrCode: roomRes.roomId });

    const room = roomService.getRoom(roomRes.roomId)!;
    const ownerSeat = room.engine!.getActiveKingdom().ownerSeat;
    const ownerSocket = [s1, s2, s3, s4][ownerSeat];

    // Select Hands (moves directly to TRICK_PLAY)
    gateway.handleSelectContract(ownerSocket, {
      roomId: room.roomId,
      contracts: ['HANDS'],
    });

    const hand = room.engine!.getState().hands[ownerSeat];
    const cardToPlay = hand[0];

    const playRes = gateway.handlePlayCard(ownerSocket, {
      roomId: room.roomId,
      card: cardToPlay,
    });

    expect(playRes.success).toBe(true);
    expect(room.engine!.getState().currentTrick.cards.length).toBe(1);
  });
});
