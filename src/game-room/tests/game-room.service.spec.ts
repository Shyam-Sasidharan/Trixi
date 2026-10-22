import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GameRoomService } from '../services/game-room.service.js';
import { RoomTimerService } from '../services/room-timer.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

describe('GameRoomService & RoomTimerService', () => {
  let roomService: GameRoomService;
  let timerService: RoomTimerService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      matchHistory: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };

    roomService = new GameRoomService(mockPrisma as PrismaService);
    timerService = new RoomTimerService();
  });

  afterEach(() => {
    timerService.stopAllTimers();
    vi.clearAllTimers();
  });

  it('should create room with host seated at Seat 0 and unique 6-character room code', () => {
    const host = { id: 'host-1', displayName: 'KingHost' };
    const room = roomService.createRoom(host, 'socket-host', {
      name: 'High Rollers',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
      turnTime: 20,
    });

    expect(room).toBeDefined();
    expect(room.roomCode.length).toBe(6);
    expect(room.status).toBe('WAITING');
    expect(room.players[0]?.userId).toBe('host-1');
    expect(room.players[0]?.seat).toBe(0);
    expect(room.players[1]).toBeNull();
    expect(room.engine).toBeNull();
  });

  it('should automatically deal cards and start match when 4th player joins', () => {
    const p1 = { id: 'p1', displayName: 'Player 1' };
    const p2 = { id: 'p2', displayName: 'Player 2' };
    const p3 = { id: 'p3', displayName: 'Player 3' };
    const p4 = { id: 'p4', displayName: 'Player 4' };

    const room = roomService.createRoom(p1, 's1', { gameMode: 'SOLO' });
    expect(room.status).toBe('WAITING');

    const res2 = roomService.joinRoom(p2, 's2', room.roomCode);
    expect(res2.seat).toBe(1);
    expect(res2.matchStarted).toBe(false);

    const res3 = roomService.joinRoom(p3, 's3', room.roomCode);
    expect(res3.seat).toBe(2);
    expect(res3.matchStarted).toBe(false);

    const res4 = roomService.joinRoom(p4, 's4', room.roomCode);
    expect(res4.seat).toBe(3);
    expect(res4.matchStarted).toBe(true);

    // Assert match engine initialization
    expect(room.status).toBe('IN_PROGRESS');
    expect(room.engine).toBeDefined();

    // Verify 13 cards dealt to each of the 4 seats
    const state = room.engine!.getState();
    expect(state.hands[0].length).toBe(13);
    expect(state.hands[1].length).toBe(13);
    expect(state.hands[2].length).toBe(13);
    expect(state.hands[3].length).toBe(13);
    expect(state.currentPhase).toBe('KINGDOM_SELECTION');
  });

  it('should reject joining when room already has 4 players', () => {
    const room = roomService.createRoom({ id: 'p1', displayName: 'P1' }, 's1', {});
    roomService.joinRoom({ id: 'p2', displayName: 'P2' }, 's2', room.roomId);
    roomService.joinRoom({ id: 'p3', displayName: 'P3' }, 's3', room.roomId);
    roomService.joinRoom({ id: 'p4', displayName: 'P4' }, 's4', room.roomId);

    expect(() =>
      roomService.joinRoom({ id: 'p5', displayName: 'P5' }, 's5', room.roomId),
    ).toThrow('Room is full');
  });

  it('should handle disconnect and reconnection smoothly', () => {
    const host = { id: 'host-1', displayName: 'Host' };
    const room = roomService.createRoom(host, 'sock-1', {});

    // Disconnect
    const disc = roomService.handleDisconnect('sock-1');
    expect(disc?.roomId).toBe(room.roomId);
    expect(room.players[0]?.isConnected).toBe(false);

    // Reconnect with new socket
    const recon = roomService.handleReconnect('host-1', 'sock-new');
    expect(recon?.seat).toBe(0);
    expect(room.players[0]?.isConnected).toBe(true);
    expect(room.players[0]?.socketId).toBe('sock-new');
  });

  it('should handle turn timer countdown and trigger timeout callback', () => {
    vi.useFakeTimers();

    const ticks: number[] = [];
    let timeoutFired = false;

    timerService.startTurnTimer(
      'room-time',
      0,
      3,
      (tick) => ticks.push(tick.remainingSeconds),
      (roomId, seat) => {
        timeoutFired = true;
      },
    );

    expect(ticks).toEqual([3]);

    // Fast-forward 1 second
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([3, 2]);

    // Fast-forward 2 more seconds
    vi.advanceTimersByTime(2000);
    expect(timeoutFired).toBe(true);

    vi.useRealTimers();
  });

  it('should provide fallback card on timeout during TRICK_PLAY', () => {
    const room = roomService.createRoom({ id: 'p1', displayName: 'P1' }, 's1', {});
    roomService.joinRoom({ id: 'p2', displayName: 'P2' }, 's2', room.roomId);
    roomService.joinRoom({ id: 'p3', displayName: 'P3' }, 's3', room.roomId);
    roomService.joinRoom({ id: 'p4', displayName: 'P4' }, 's4', room.roomId);

    const ownerSeat = room.engine!.getActiveKingdom().ownerSeat;
    room.engine!.selectContracts(['HANDS']); // Hands moves directly to TRICK_PLAY

    const fallbackCard = roomService.getFallbackCardToPlay(room, ownerSeat);
    expect(fallbackCard).toBeDefined();
    expect(fallbackCard?.power).toBeGreaterThanOrEqual(2);
  });
});
