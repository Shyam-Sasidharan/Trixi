import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { GameGateway } from './game.gateway.js';
import { GameRoomService } from './services/game-room.service.js';
import { RoomTimerService } from './services/room-timer.service.js';
import { JwtService } from '@nestjs/jwt';

describe('GameGateway', () => {
  let gateway: GameGateway;

  beforeEach(async () => {
    const mockGameRoomService = {
      createRoom: () => ({ roomId: 'test', roomCode: 'TRX123' }),
      joinRoom: () => ({ room: { roomId: 'test' }, seat: 1, matchStarted: false }),
      getRoom: () => null,
      handleDisconnect: () => null,
      handleReconnect: () => null,
    };

    const mockRoomTimerService = {
      startTurnTimer: () => {},
      startDoublingTimer: () => {},
      stopTimer: () => {},
    };

    const mockJwtService = {
      verifyAsync: () => Promise.resolve({ sub: 'user-1', email: 'test@trix.com' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameGateway,
        { provide: GameRoomService, useValue: mockGameRoomService },
        { provide: RoomTimerService, useValue: mockRoomTimerService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    gateway = module.get<GameGateway>(GameGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
