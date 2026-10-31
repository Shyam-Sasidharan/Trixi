import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { GameGateway } from '../game.gateway.js';
import { GameRoomService } from '../services/game-room.service.js';
import { RoomTimerService } from '../services/room-timer.service.js';
import { BotFillService } from '../../bot/bot-fill.service.js';
import { BotActionService } from '../../bot/bot-action.service.js';
import { BotBrainService } from '../../bot/bot-brain.service.js';
import { MatchmakingService } from '../../matchmaking/matchmaking.service.js';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { GameRoomModule } from '../game-room.module.js';
import { BotModule } from '../../bot/bot.module.js';

describe('[P0/P1] Multiplayer Stabilization & Action Plan Verification', () => {
  let gateway: GameGateway;
  let roomService: GameRoomService;
  let timerService: RoomTimerService;
  let botFillService: BotFillService;
  let mockServer: any;
  let emittedEvents: Array<{ event: string; payload: any }>;

  beforeEach(() => {
    vi.useFakeTimers();
    emittedEvents = [];

    const mockPrisma = {
      matchHistory: { create: vi.fn().mockResolvedValue({ id: 'match-1' }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };

    roomService = new GameRoomService(mockPrisma as any);
    timerService = new RoomTimerService();
    botFillService = new BotFillService(roomService);
    const jwtService = new JwtService({ secret: 'test-secret' });

    gateway = new GameGateway(roomService, timerService, jwtService, undefined, botFillService);

    mockServer = {
      to: vi.fn().mockImplementation((roomId: string) => {
        return {
          emit: vi.fn().mockImplementation((event: string, payload: any) => {
            emittedEvents.push({ event, payload });
          }),
        };
      }),
      emit: vi.fn().mockImplementation((event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      }),
    };

    gateway.server = mockServer;
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
        user: { id: userId, email: `${userId}@trix.local`, displayName },
      },
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn().mockImplementation((event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      }),
    };
  }

  it('DI-01: should resolve NestJS DI container and verify BotFillService accesses GameGateway', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GameRoomModule, BotModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        matchHistory: { create: vi.fn().mockResolvedValue({ id: 'match-di' }) },
        user: { update: vi.fn().mockResolvedValue({}) },
      })
      .overrideProvider(RedisService)
      .useValue({
        getClient: vi.fn().mockReturnValue(null),
      })
      .overrideProvider(JwtService)
      .useValue(new JwtService({ secret: 'test-secret' }))
      .compile();

    const resolvedBotFill = moduleRef.get(BotFillService);
    const resolvedGateway = moduleRef.get(GameGateway);

    expect(resolvedBotFill).toBeDefined();
    expect(resolvedGateway).toBeDefined();
    expect(resolvedBotFill.getGateway()).toBeDefined();
  });

  it('BE-01 & BE-07: Auto-trigger match start & dealt hand broadcast with strict sequential order', () => {
    const humanSocket = createMockSocket('sock-human-1', 'user-human-1', 'HumanHost');

    // 1. Host creates public room with allowBots: true
    const createRes = gateway.handleCreateRoom(humanSocket, {
      name: 'Championship Arena',
      gameMode: 'SOLO',
      kingdomType: 'FREE_MERCY',
      turnTime: 20,
      isPrivate: false,
      allowBots: true,
    });

    expect(createRes.success).toBe(true);
    const roomId = createRes.roomId;

    emittedEvents = []; // Reset events to observe join sequence

    // 2. Backfill 3 bots immediately
    botFillService.populateRoomWithBots(roomId, true);

    const room = roomService.getRoom(roomId)!;
    expect(room.status).toBe('IN_PROGRESS');
    expect(room.engine).toBeDefined();

    // 3. Verify event sequence order: player_joined (seat 3) -> room_updated (4/4) -> match_started -> game_state
    const eventNames = emittedEvents.map((e) => e.event);

    const seat3JoinIdx = emittedEvents.findIndex(
      (e) => e.event === 'player_joined' && e.payload.seat === 3,
    );
    expect(seat3JoinIdx).toBeGreaterThanOrEqual(0);

    const matchStartedIdx = emittedEvents.findIndex((e) => e.event === 'match_started');
    expect(matchStartedIdx).toBeGreaterThan(seat3JoinIdx);

    const gameStateIdx = emittedEvents.findIndex((e) => e.event === 'game_state');
    expect(gameStateIdx).toBeGreaterThan(matchStartedIdx);

    // 4. Verify match_started contains BE-01 & BE-06 fields
    const matchStartedEvent = emittedEvents[matchStartedIdx].payload;
    expect(matchStartedEvent.roomId).toBe(roomId);
    expect(matchStartedEvent.kingdomIndex).toBe(1);
    expect(matchStartedEvent.kingdomOwnerSeat).toBe(room.engine!.getActiveKingdom().ownerSeat);
    expect(matchStartedEvent.roomSequence).toBeGreaterThan(0);

    // 5. Verify human player received their 13 dealt cards in game_state without reconnect_game
    const humanGameState = emittedEvents.find(
      (e) => e.event === 'game_state' && e.payload.mySeat === 0,
    )!.payload;

    expect(humanGameState.myHand.length).toBe(13);
    expect(humanGameState.opponents.length).toBe(3);
    expect(humanGameState.roomSequence).toBeGreaterThan(0);
    expect(humanGameState.serverTime).toBeDefined();
    expect(humanGameState.turnId).toBe(1);

    // Assert anti-cheat: opponents cards are masked
    for (const opp of humanGameState.opponents) {
      expect((opp as any).cards).toBeUndefined();
      expect(opp.remainingCardCount).toBe(13);
      expect(opp.isBot).toBe(false); // Disguised!
    }
  });

  it('BE-02: Structured acknowledgments for quick_play, join_queue, and leave_queue', async () => {
    const s1 = createMockSocket('s-q1', 'u-q1', 'QueuePlayer1');

    // 1. quick_play acknowledgment
    const qpRes = await gateway.handleQuickPlay(s1, { gameMode: 'SOLO', kingdomType: 'FREE_MERCY' });
    expect(qpRes.success).toBe(true);
    expect(['QUEUED', 'MATCHED']).toContain(qpRes.status);
    expect(qpRes.roomId).toBeDefined();

    // 2. join_queue acknowledgment
    const s2 = createMockSocket('s-q2', 'u-q2', 'QueuePlayer2');
    const jqRes = await gateway.handleJoinQueue(s2, { gameMode: 'SOLO', kingdomType: 'FREE_MERCY' });
    expect(jqRes.success).toBe(true);
    expect(jqRes.queueLength).toBeGreaterThanOrEqual(1);

    // 3. leave_queue acknowledgment
    const lqRes = await gateway.handleLeaveQueue(s2);
    expect(lqRes.success).toBe(true);
    expect(lqRes.message).toBe('Queue left successfully');
  });

  it('BE-03: Socket room membership cleanup and cross-room event isolation', () => {
    const s1 = createMockSocket('sock-multi', 'user-multi', 'MultiRoomPlayer');

    // Join room 1
    const r1Res = gateway.handleCreateRoom(s1, { name: 'Room 1', isPrivate: true });
    expect(s1.join).toHaveBeenCalledWith(r1Res.roomId);

    // Join room 2 -> verify socket left Room 1
    const r2Res = gateway.handleCreateRoom(s1, { name: 'Room 2', isPrivate: true });
    expect(s1.leave).toHaveBeenCalledWith(r1Res.roomId);
    expect(s1.join).toHaveBeenCalledWith(r2Res.roomId);

    // Disconnect -> verify cleanup
    gateway.handleDisconnect(s1);
    expect(s1.leave).toHaveBeenCalledWith(r2Res.roomId);
  });

  it('BE-04: Structured error handling for join_room with explicit error codes', () => {
    const host = createMockSocket('s-host', 'u-host', 'HostUser');
    const player = createMockSocket('s-player', 'u-player', 'JoiningPlayer');

    // 1. Non-existent room -> ROOM_NOT_FOUND
    const notFoundRes = gateway.handleJoinRoom(player, { roomIdOrCode: 'NON_EXISTENT_999' });
    expect(notFoundRes.success).toBe(false);
    expect(notFoundRes.code).toBe('ROOM_NOT_FOUND');
    expect(notFoundRes.message).toBe('Room not found or expired');

    // Create a private password-protected room
    const passRoomRes = gateway.handleCreateRoom(host, {
      name: 'Password Room',
      password: 'SecretPassword123',
      isPrivate: true,
    });

    // 2. Wrong password -> INVALID_PASSWORD
    const wrongPassRes = gateway.handleJoinRoom(player, {
      roomIdOrCode: passRoomRes.roomId,
      password: 'WrongPassword',
    });
    expect(wrongPassRes.success).toBe(false);
    expect(wrongPassRes.code).toBe('INVALID_PASSWORD');
    expect(wrongPassRes.message).toBe('Invalid room password');

    // Fill room to 4/4
    const p2 = createMockSocket('s-p2', 'u-p2', 'P2');
    const p3 = createMockSocket('s-p3', 'u-p3', 'P3');
    const p4 = createMockSocket('s-p4', 'u-p4', 'P4');

    gateway.handleJoinRoom(p2, { roomIdOrCode: passRoomRes.roomId, password: 'SecretPassword123' });
    gateway.handleJoinRoom(p3, { roomIdOrCode: passRoomRes.roomId, password: 'SecretPassword123' });
    gateway.handleJoinRoom(p4, { roomIdOrCode: passRoomRes.roomId, password: 'SecretPassword123' });

    // 3. Full room / match in progress -> ROOM_FULL / MATCH_IN_PROGRESS
    const p5 = createMockSocket('s-p5', 'u-p5', 'P5');
    const fullRes = gateway.handleJoinRoom(p5, {
      roomIdOrCode: passRoomRes.roomId,
      password: 'SecretPassword123',
    });
    expect(fullRes.success).toBe(false);
    expect(['ROOM_FULL', 'MATCH_IN_PROGRESS']).toContain(fullRes.code);
  });

  it('BE-05: Honor allowBots in CreateRoomConfig and matchmaking segregation', () => {
    const host = createMockSocket('s-nobot-host', 'u-nobot-host', 'NoBotHost');

    // 1. Create room with allowBots: false
    const roomRes = gateway.handleCreateRoom(host, {
      name: 'No Bot Room',
      isPrivate: false,
      allowBots: false,
    });

    const room = roomService.getRoom(roomRes.roomId)!;
    expect(room.allowBots).toBe(false);

    // Schedule backfill -> should do nothing
    botFillService.scheduleBackfill(room);
    vi.advanceTimersByTime(30000);

    // Room must still have only 1 occupant (the host)
    expect(room.players.filter((p) => p !== null).length).toBe(1);
    expect(room.status).toBe('WAITING');

    // 2. Segregate queues: seeking allowBots: false must not match allowBots: true room
    const botRoom = roomService.createRoom(
      { id: 'u-bothost', displayName: 'BotHost' },
      's-bothost',
      { name: 'Bot Room', allowBots: true, isPrivate: false },
    );

    const foundForNoBots = roomService.findWaitingPublicRoom('SOLO', 'FREE_MERCY', false);
    expect(foundForNoBots?.roomId).toBe(room.roomId);

    const foundForBots = roomService.findWaitingPublicRoom('SOLO', 'FREE_MERCY', true);
    expect(foundForBots?.roomId).toBe(botRoom.roomId);
  });

  it('BE-06 & BE-08: Monotonic sequence versioning and Action-ID deduplication', () => {
    const s0 = createMockSocket('s0', 'u0', 'P0');
    const s1 = createMockSocket('s1', 'u1', 'P1');
    const s2 = createMockSocket('s2', 'u2', 'P2');
    const s3 = createMockSocket('s3', 'u3', 'P3');

    const roomRes = gateway.handleCreateRoom(s0, { isPrivate: true });
    gateway.handleJoinRoom(s1, { roomIdOrCode: roomRes.roomId });
    gateway.handleJoinRoom(s2, { roomIdOrCode: roomRes.roomId });
    gateway.handleJoinRoom(s3, { roomIdOrCode: roomRes.roomId });

    const room = roomService.getRoom(roomRes.roomId)!;
    expect(room.status).toBe('IN_PROGRESS');

    const initialSeq = room.roomSequence;
    expect(initialSeq).toBeGreaterThan(0);

    // Kingdom owner selects contract
    const ownerSeat = room.engine!.getActiveKingdom().ownerSeat;
    const selectRes1 = gateway.executeSelectContract(
      room.roomId,
      ownerSeat,
      ['HANDS'],
      'action-contract-1',
    );
    expect(selectRes1.success).toBe(true);
    expect(selectRes1.actionId).toBe('action-contract-1');
    expect(selectRes1.roomSequence).toBeGreaterThan(initialSeq);

    // Duplicate contract selection with same actionId -> cached ack
    const selectRes2 = gateway.executeSelectContract(
      room.roomId,
      ownerSeat,
      ['HANDS'],
      'action-contract-1',
    );
    expect(selectRes2.success).toBe(true);
    expect(selectRes2.duplicate).toBe(true);
    expect(selectRes2.actionId).toBe('action-contract-1');

    // Current turn player plays a card with actionId
    const currentTurn = room.engine!.getState().currentTurnSeat;
    const currentTurnHand = room.engine!.getState().hands[currentTurn];
    const cardToPlay = currentTurnHand[0];

    const playRes1 = gateway.executePlayCard(room.roomId, currentTurn, cardToPlay, {
      actionId: 'action-card-play-1',
      turnId: room.turnId,
    });
    expect(playRes1.success).toBe(true);
    expect(playRes1.actionId).toBe('action-card-play-1');
    expect(playRes1.roomSequence).toBeGreaterThan(selectRes1.roomSequence);

    // Duplicate play_card with same actionId -> returns duplicate: true without error
    const playRes2 = gateway.executePlayCard(room.roomId, currentTurn, cardToPlay, {
      actionId: 'action-card-play-1',
      turnId: room.turnId,
    });
    expect(playRes2.success).toBe(true);
    expect(playRes2.duplicate).toBe(true);
    expect(playRes2.actionId).toBe('action-card-play-1');

    // Reconnection snapshot test: includes turnId, deadlineAt, roomSequence
    const reconRes = gateway.handleReconnectGame(s0, { roomId: room.roomId });
    expect(reconRes.success).toBe(true);
    expect(reconRes.turnId).toBeDefined();
    expect(reconRes.roomSequence).toBeDefined();
    expect(reconRes.deadlineAt !== undefined).toBe(true);
  });
});

