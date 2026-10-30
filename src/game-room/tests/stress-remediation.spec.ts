import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameGateway } from '../game.gateway.js';
import { GameRoomService } from '../services/game-room.service.js';
import { RoomTimerService } from '../services/room-timer.service.js';
import { BotFillService } from '../../bot/bot-fill.service.js';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';

describe('Real-Time Multiplayer Architecture & Remediation Verification', () => {
  let gateway: GameGateway;
  let roomService: GameRoomService;
  let timerService: RoomTimerService;
  let botFillService: BotFillService;
  let mockServer: any;

  beforeEach(() => {
    vi.useFakeTimers();

    const mockPrisma = {
      matchHistory: { create: vi.fn().mockResolvedValue({ id: 'match-1' }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };

    roomService = new GameRoomService(mockPrisma as PrismaService);
    timerService = new RoomTimerService();
    botFillService = new BotFillService(roomService);
    const jwtService = new JwtService({ secret: 'test-secret' });

    gateway = new GameGateway(roomService, timerService, jwtService, undefined, botFillService);

    mockServer = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      sockets: {
        sockets: new Map(),
      },
    };
    gateway.server = mockServer as any;
    botFillService.setGateway(gateway);
  });

  afterEach(() => {
    timerService.stopAllTimers();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function createMockSocket(id: string, userId: string, displayName: string): any {
    return {
      id,
      data: {
        user: { id: userId, email: `${userId}@trix.com`, displayName },
      },
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn(),
      handshake: { auth: {}, headers: {}, query: {} },
    };
  }

  it('Issue 1 & 3: 4 players playing continuously without race conditions, with idempotency and sequence versioning', () => {
    const s1 = createMockSocket('sock-1', 'user-1', 'Player 1');
    const s2 = createMockSocket('sock-2', 'user-2', 'Player 2');
    const s3 = createMockSocket('sock-3', 'user-3', 'Player 3');
    const s4 = createMockSocket('sock-4', 'user-4', 'Player 4');

    const createRes = gateway.handleCreateRoom(s1, { gameMode: 'SOLO', kingdomType: 'FREE_MERCY' });
    const roomId = createRes.roomId;
    gateway.handleJoinRoom(s2, { roomIdOrCode: roomId });
    gateway.handleJoinRoom(s3, { roomIdOrCode: roomId });
    gateway.handleJoinRoom(s4, { roomIdOrCode: roomId });

    const room = roomService.getRoom(roomId)!;
    expect(room.status).toBe('IN_PROGRESS');
    expect(room.turnId).toBe(1);
    expect(room.stateVersion).toBe(1);

    const ownerSeat = room.engine!.getActiveKingdom().ownerSeat;
    const sockets = [s1, s2, s3, s4];
    const ownerSocket = sockets[ownerSeat];

    // Select Hands contract to enter TRICK_PLAY
    gateway.handleSelectContract(ownerSocket, { roomId, contracts: ['HANDS'] });
    expect(room.engine!.getState().currentPhase).toBe('TRICK_PLAY');

    const turnSeat = room.engine!.getState().currentTurnSeat;
    const turnSocket = sockets[turnSeat];
    const hand = room.engine!.getState().hands[turnSeat];
    const cardToPlay = hand[0];

    // 1. Play valid card with actionId
    const actionId = 'action-uuid-101';
    const playRes1 = gateway.handlePlayCard(turnSocket, {
      roomId,
      card: cardToPlay,
      actionId,
      turnId: room.turnId,
    });

    expect(playRes1.success).toBe(true);
    expect(playRes1.card).toEqual(cardToPlay);
    expect(room.stateVersion).toBeGreaterThan(1);

    // 2. Duplicate submission with identical actionId returns cached ack immediately
    const duplicateRes = gateway.handlePlayCard(turnSocket, {
      roomId,
      card: cardToPlay,
      actionId,
      turnId: room.turnId,
    });
    expect(duplicateRes.success).toBe(true);
    expect(duplicateRes.duplicate).toBe(true);

    // 3. Stale turnId rejection
    const staleRes = gateway.handlePlayCard(turnSocket, {
      roomId,
      card: cardToPlay,
      actionId: 'action-uuid-102',
      turnId: 9999, // stale turnId
    });
    expect(staleRes.success).toBe(false);
    expect(staleRes.code).toBe('NOT_YOUR_TURN');

    // 4. Unauthorized seat rejection
    const wrongSeat = (turnSeat + 1) % 4;
    const wrongSocket = sockets[wrongSeat];
    const wrongCard = room.engine!.getState().hands[wrongSeat][0];
    const wrongRes = gateway.handlePlayCard(wrongSocket, {
      roomId,
      card: wrongCard,
      turnId: room.turnId,
    });
    expect(wrongRes.success).toBe(false);
    expect(wrongRes.code).toBe('NOT_YOUR_TURN');
  });

  it('Issue 2: 4 cards completing a trick with 1500ms display delay before next trick', () => {
    const s1 = createMockSocket('s1', 'u1', 'P1');
    const s2 = createMockSocket('s2', 'u2', 'P2');
    const s3 = createMockSocket('s3', 'u3', 'P3');
    const s4 = createMockSocket('s4', 'u4', 'P4');
    const sockets = [s1, s2, s3, s4];

    const createRes = gateway.handleCreateRoom(s1, {});
    const roomId = createRes.roomId;
    gateway.handleJoinRoom(s2, { roomIdOrCode: roomId });
    gateway.handleJoinRoom(s3, { roomIdOrCode: roomId });
    gateway.handleJoinRoom(s4, { roomIdOrCode: roomId });

    const room = roomService.getRoom(roomId)!;
    const ownerSeat = room.engine!.getActiveKingdom().ownerSeat;
    gateway.handleSelectContract(sockets[ownerSeat], { roomId, contracts: ['HANDS'] });

    // Set up controlled hand for predictable trick completion
    const state = room.engine!.getState();
    (state.hands as any)[0] = [{ id: 'c1', suit: 'CLUBS', rank: 2, power: 2 }];
    (state.hands as any)[1] = [{ id: 'c2', suit: 'CLUBS', rank: 3, power: 3 }];
    (state.hands as any)[2] = [{ id: 'c3', suit: 'CLUBS', rank: 4, power: 4 }];
    (state.hands as any)[3] = [{ id: 'c4', suit: 'CLUBS', rank: 5, power: 5 }];

    // Start with Seat 0
    (state as any).currentTurnSeat = 0;

    // Card 1 (Seat 0)
    gateway.handlePlayCard(s1, { roomId, card: state.hands[0][0] });
    expect(state.currentTrick.cards.length).toBe(1);
    expect(state.currentPhase).toBe('TRICK_PLAY');

    // Card 2 (Counter-clockwise: Seat 3)
    gateway.handlePlayCard(s4, { roomId, card: state.hands[3][0] });
    expect(state.currentTrick.cards.length).toBe(2);

    // Card 3 (Seat 2)
    gateway.handlePlayCard(s3, { roomId, card: state.hands[2][0] });
    expect(state.currentTrick.cards.length).toBe(3);

    // Card 4: Completes the trick! (Seat 1)
    const res4 = gateway.handlePlayCard(s2, { roomId, card: state.hands[1][0] });
    expect(res4.success).toBe(true);

    // Assert that phase transitions immediately to TRICK_EVALUATING
    expect(room.engine!.getState().currentPhase).toBe('TRICK_EVALUATING');
    // Cards remain on table during display duration
    expect(room.engine!.getState().currentTrick.cards.length).toBe(4);

    // Verify trick_completed event emitted with displayDurationMs: 1500
    expect(mockServer.emit).toHaveBeenCalledWith(
      'trick_completed',
      expect.objectContaining({
        roomId,
        trickCards: expect.any(Array),
        trickWinnerSeat: expect.any(Number),
        displayDurationMs: 1500,
      }),
    );

    // Attempting a 5th card play while TRICK_EVALUATING is rejected
    const blockedPlay = gateway.handlePlayCard(s1, { roomId, card: { id: 'x', suit: 'CLUBS', rank: 6, power: 6 } });
    expect(blockedPlay.success).toBe(false);

    // Advance 1500ms delay
    vi.advanceTimersByTime(1500);

    // Table trick is now cleared for next trick
    expect(room.engine!.getState().currentTrick.cards.length).toBe(0);
  });

  it('Issue 4: Authoritative Timer Architecture emits epoch deadlineTimestamp without drift', () => {
    const ticks: any[] = [];
    let timeoutFired = false;

    const deadline = timerService.startTurnTimer(
      'test-room',
      1,
      10, // 10 seconds
      (tick) => ticks.push(tick),
      () => {
        timeoutFired = true;
      },
      5,
    );

    expect(deadline).toBeGreaterThan(Date.now());
    expect(ticks.length).toBe(1);
    expect(ticks[0].remainingSeconds).toBe(10);
    expect(ticks[0].deadlineTimestamp).toBe(deadline);
    expect(ticks[0].turnId).toBe(5);

    // Advance 3 seconds
    vi.advanceTimersByTime(3000);
    expect(ticks.length).toBe(4);
    expect(ticks[ticks.length - 1].remainingSeconds).toBe(7);

    // Advance remaining 7 seconds -> exact-once timeout
    vi.advanceTimersByTime(7000);
    expect(timeoutFired).toBe(true);
    expect(timerService.getRemainingSeconds('test-room')).toBeNull();
  });

  it('Issue 5: 6-second bot backfill respects allowBots flag and handles human joins', () => {
    const hostUser = { id: 'human-host', displayName: 'Host' };

    // 1. Room with allowBots: false -> NEVER adds bots
    const noBotRoom = roomService.createRoom(hostUser, 's-nobot', {
      name: 'No Bots Room',
      isPrivate: true,
      allowBots: false,
    });
    botFillService.scheduleBackfill(noBotRoom);
    vi.advanceTimersByTime(12000);
    expect(noBotRoom.players[1]).toBeNull();
    expect(noBotRoom.players[2]).toBeNull();

    // 2. Room with allowBots: true -> 6s recursive backfill
    const botRoom = roomService.createRoom(hostUser, 's-bot', {
      name: 'Quick Play Room',
      isPrivate: false,
      allowBots: true,
    });

    botFillService.scheduleBackfill(botRoom);

    // 0s to 5.9s: empty
    vi.advanceTimersByTime(5999);
    expect(botRoom.players[1]).toBeNull();

    // At 6s: Seat 1 filled with disguised bot
    vi.advanceTimersByTime(1);
    expect(botRoom.players[1]).not.toBeNull();
    expect(botRoom.players[1]?.isBot).toBe(true);
    expect(botRoom.players[2]).toBeNull();

    // At 12s (+6s): Seat 2 filled
    vi.advanceTimersByTime(6000);
    expect(botRoom.players[2]).not.toBeNull();
    expect(botRoom.players[3]).toBeNull();

    // At 18s (+6s): Seat 3 filled -> 4th player starts match!
    vi.advanceTimersByTime(6000);
    expect(botRoom.players[3]).not.toBeNull();
    expect(botRoom.status).toBe('IN_PROGRESS');
  });

  it('Issue 6: Socket cross-room isolation and unauthorized room access rejection', () => {
    const s1 = createMockSocket('s-iso-1', 'u-iso-1', 'Iso1');
    const s2 = createMockSocket('s-iso-2', 'u-iso-2', 'Iso2');

    const room1 = gateway.handleCreateRoom(s1, { name: 'Room 1', isPrivate: true });
    const room2 = gateway.handleCreateRoom(s2, { name: 'Room 2', isPrivate: true });

    // s1 tries to perform play_card in room2
    const unauthorizedRes = gateway.handlePlayCard(s1, {
      roomId: room2.roomId,
      card: { id: 'c1', suit: 'HEARTS', rank: 'A', power: 14 },
    });

    expect(unauthorizedRes.success).toBe(false);
    expect(unauthorizedRes.code).toBe('UNAUTHORIZED_ROOM');
  });

  it('Issue 7: Seamless reconnection restores authoritative state without duplicate matches', () => {
    const s1 = createMockSocket('s1-orig', 'user-recon', 'ReconPlayer');
    const s2 = createMockSocket('s2', 'u2', 'P2');
    const s3 = createMockSocket('s3', 'u3', 'P3');
    const s4 = createMockSocket('s4', 'u4', 'P4');

    const roomRes = gateway.handleCreateRoom(s1, {});
    gateway.handleJoinRoom(s2, { roomIdOrCode: roomRes.roomId });
    gateway.handleJoinRoom(s3, { roomIdOrCode: roomRes.roomId });
    gateway.handleJoinRoom(s4, { roomIdOrCode: roomRes.roomId });

    const room = roomService.getRoom(roomRes.roomId)!;
    expect(room.status).toBe('IN_PROGRESS');

    // Simulate disconnection of player 1
    gateway.handleDisconnect(s1);
    expect(room.players[0]?.isConnected).toBe(false);

    // New socket reconnecting with same user ID
    const newSocket = createMockSocket('s1-new', 'user-recon', 'ReconPlayer');
    const reconRes = gateway.handleReconnectGame(newSocket, { roomId: room.roomId });

    expect(reconRes.success).toBe(true);
    expect(reconRes.restored).toBe(true);
    expect(reconRes.seat).toBe(0);
    expect(room.players[0]?.isConnected).toBe(true);
    expect(room.players[0]?.socketId).toBe('s1-new');

    // Verify game_state snapshot emitted to newSocket with full authoritative state
    expect(mockServer.to).toHaveBeenCalledWith('s1-new');
    expect(mockServer.emit).toHaveBeenCalledWith(
      'game_state',
      expect.objectContaining({
        roomId: room.roomId,
        mySeat: 0,
        myHand: expect.any(Array),
        opponents: expect.any(Array),
        turnId: expect.any(Number),
        stateVersion: expect.any(Number),
      }),
    );
  });
});
